import { InlineKeyboardButton, Update } from "@grammyjs/types";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Translate } from "../i18n-service.js";
import { TelegramContext } from "./telegram-context.js";
import { extractTelegramCommand } from "./telegram-extractors.js";
import { anyOf, callbackQuery, command, message } from "./telegram-filters.js";
import { pageButtons, TelegramPage } from "./telegram-pagination.js";
import {
    addDays,
    formatDate,
    parseDate,
    parseNumber,
} from "./telegram-parsers.js";
import {
    cancel,
    next,
    stay,
    TelegramInputControl,
    TelegramStep,
    TelegramStepFactory,
} from "./telegram-scene.js";

export type TelegramStepProperty<TPayload, TValue> = {
    [Key in keyof TPayload]-?: TValue extends TPayload[Key] ? Key : never;
}[keyof TPayload];

export interface TelegramStepPromptOptions<TPayload, TValue> {
    name: string;
    property: TelegramStepProperty<TPayload, TValue>;
    prompt: (t: Translate) => string;
    optional?: boolean;
}

export interface TelegramTextStepOptions<
    TPayload,
> extends TelegramStepPromptOptions<TPayload, string> {
    validate?: (text: string, t: Translate) => string | undefined;
}

export interface TelegramNumberStepOptions<
    TPayload,
> extends TelegramStepPromptOptions<TPayload, number> {
    range?: { min: number; max: number };
    maxFractionDigits?: number;
}

export type TelegramDateStepOptions<TPayload> = TelegramStepPromptOptions<
    TPayload,
    string
>;

export interface TelegramChoice {
    label: string;
    value: string;
}

export interface TelegramChoiceStepOptions<
    TPayload,
> extends TelegramStepPromptOptions<TPayload, string> {
    load: (
        ctx: TelegramContext,
        input: TelegramInputControl<TPayload>,
        page: { offset: number; limit: number },
    ) => Promise<TelegramPage<TelegramChoice>>;
    pageSize?: number;
}

const skipCommand = command("skip");
const textOnly = message("text");
const textOrSkip = anyOf(message("text"), skipCommand);
const choicePageSchema = Type.Object({ page: Type.Integer({ minimum: 0 }) });
const choiceValueSchema = Type.Object({ value: Type.String() });
const defaultChoicePageSize = 8;

export function textStep<TPayload>(
    step: TelegramStepFactory<TPayload>,
    options: TelegramTextStepOptions<TPayload>,
): TelegramStep<TPayload> {
    return step(options.name, options.optional ? textOrSkip : textOnly, {
        enter: async (ctx) => {
            await ctx.reply(options.prompt(ctx.t));
        },
        handle: async (ctx) => {
            if (isSkip(ctx.update)) {
                return next();
            }

            const text = ctx.update.message.text;
            const error = options.validate?.(text, ctx.t);

            if (error) {
                await ctx.reply(error);
                return stay();
            }

            return next(patch(options.property, text));
        },
    });
}

export function numberStep<TPayload>(
    step: TelegramStepFactory<TPayload>,
    options: TelegramNumberStepOptions<TPayload>,
): TelegramStep<TPayload> {
    return step(options.name, options.optional ? textOrSkip : textOnly, {
        enter: async (ctx) => {
            await ctx.reply(options.prompt(ctx.t));
        },
        handle: async (ctx) => {
            if (isSkip(ctx.update)) {
                return next();
            }

            const value = parseNumber(ctx.update.message.text, {
                maxFractionDigits: options.maxFractionDigits,
            });

            if (value === undefined) {
                await ctx.reply(ctx.t("telegram:invalidNumber"));
                return stay();
            }

            if (
                options.range &&
                (value < options.range.min || value > options.range.max)
            ) {
                await ctx.reply(
                    ctx.t("telegram:numberOutOfRange", options.range),
                );
                return stay();
            }

            return next(patch(options.property, value));
        },
    });
}

export function dateStep<TPayload>(
    step: TelegramStepFactory<TPayload>,
    options: TelegramDateStepOptions<TPayload>,
): TelegramStep<TPayload> {
    const accepts = options.optional
        ? anyOf(message("text"), callbackQuery("data"), skipCommand)
        : anyOf(message("text"), callbackQuery("data"));

    return step(options.name, accepts, {
        enter: async (ctx, input) => {
            await ctx.reply(options.prompt(ctx.t), {
                reply_markup: {
                    inline_keyboard: [
                        [
                            input.button(ctx.t("telegram:today"), "today"),
                            input.button(
                                ctx.t("telegram:yesterday"),
                                "yesterday",
                            ),
                        ],
                    ],
                },
            });
        },
        handle: async (ctx, input) => {
            if (isSkip(ctx.update)) {
                return next();
            }

            const today = formatDate(new Date(), ctx.timeZone);
            const pressed = input.pressed;

            if (pressed === "today" || pressed === "yesterday") {
                const date =
                    pressed === "yesterday" ? addDays(today, -1) : today;

                return next(patch(options.property, date));
            }

            const date = parseDate(ctx.update.message?.text ?? "", today);

            if (!date) {
                await ctx.reply(ctx.t("telegram:invalidDate"));
                return stay();
            }

            return next(patch(options.property, date));
        },
    });
}

export function choiceStep<TPayload>(
    step: TelegramStepFactory<TPayload>,
    options: TelegramChoiceStepOptions<TPayload>,
): TelegramStep<TPayload> {
    const pageSize = options.pageSize ?? defaultChoicePageSize;
    const accepts = options.optional
        ? anyOf(callbackQuery("data"), skipCommand)
        : callbackQuery("data");

    const buildKeyboard = async (
        ctx: TelegramContext,
        input: TelegramInputControl<TPayload>,
        pageIndex: number,
    ): Promise<InlineKeyboardButton[][]> => {
        const page = await options.load(ctx, input, {
            offset: pageIndex * pageSize,
            limit: pageSize,
        });
        const navigation = pageButtons(
            pageIndex,
            page.total,
            pageSize,
            (text, target) => input.button(text, { page: target }),
        );

        return [
            ...page.items.map(({ label, value }) => [
                input.button(label, { value }),
            ]),
            ...(navigation.length ? [navigation] : []),
        ];
    };

    return step(options.name, accepts, {
        hint: (t) => t("telegram:chooseWithButtons"),
        enter: async (ctx, input) => {
            const keyboard = await buildKeyboard(ctx, input, 0);

            if (!keyboard.length) {
                if (options.optional) {
                    return next();
                }

                await ctx.reply(ctx.t("telegram:nothingToChoose"));
                return cancel({ silent: true });
            }

            await ctx.reply(options.prompt(ctx.t), {
                reply_markup: { inline_keyboard: keyboard },
            });
        },
        handle: async (ctx, input) => {
            if (isSkip(ctx.update)) {
                return next();
            }

            const pressed = input.pressed;

            if (Value.Check(choicePageSchema, pressed)) {
                await ctx.editReplyMarkup({
                    inline_keyboard: await buildKeyboard(
                        ctx,
                        input,
                        pressed.page,
                    ),
                });
                return stay();
            }

            return Value.Check(choiceValueSchema, pressed)
                ? next(patch(options.property, pressed.value))
                : stay();
        },
    });
}

function isSkip(update: Update): boolean {
    return extractTelegramCommand(update)?.name === "skip";
}

function patch<TPayload, TValue>(
    property: TelegramStepProperty<TPayload, TValue>,
    value: TValue,
): Partial<TPayload> {
    return { [property]: value } as Partial<TPayload>;
}
