import {
    ForceReply,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
} from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import { telegramScreenSchema } from "./telegram-scene-screens.js";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";

const telegramButtonSchema = Type.Union([
    Type.Object({
        kind: Type.Literal("scene"),
        name: Type.String(),
        value: Type.Unknown(),
        armed: Type.Optional(Type.Literal(true)),
    }),
    Type.Object({
        kind: Type.Literal("input"),
        step: Type.String(),
        value: Type.Unknown(),
    }),
    Type.Object({
        kind: Type.Literal("screen"),
        screen: telegramScreenSchema,
    }),
    Type.Object({
        kind: Type.Literal("back"),
    }),
]);

export const telegramConfirmationSchema = Type.Object({
    name: Type.String(),
    value: Type.Unknown(),
});

export const telegramButtonsStateSchema = Type.Object({
    nextId: Type.Number(),
    messages: Type.Array(
        Type.Object({
            messageId: Type.Number(),
            buttons: Type.Record(Type.String(), telegramButtonSchema),
        }),
    ),
});

export type TelegramButton = Static<typeof telegramButtonSchema>;

export type TelegramSceneButton = Extract<TelegramButton, { kind: "scene" }>;

export type TelegramMessageMarkup =
    | InlineKeyboardMarkup
    | ReplyKeyboardMarkup
    | ReplyKeyboardRemove
    | ForceReply;

export interface TelegramButtonPress {
    sceneId: string;
    buttonId: string;
    messageId: number;
}

const callbackDataPattern = /^([\w-]{1,32}):(\d+)$/;

export function parseTelegramButtonPress(
    update: Update,
): TelegramButtonPress | undefined {
    const callbackQuery = update.callback_query;
    const match = callbackDataPattern.exec(callbackQuery?.data ?? "");
    const messageId = callbackQuery?.message?.message_id;

    if (!match?.[1] || !match[2] || messageId === undefined) {
        return;
    }

    return { sceneId: match[1], buttonId: match[2], messageId };
}

export function createSceneButton(
    instance: TelegramSceneInstance,
    text: string,
    button: TelegramButton,
): InlineKeyboardButton.CallbackButton {
    const unsent = instance.unsentButtons;
    const id =
        findSameButton(unsent, button) ??
        findSameButton(storedButtonsOf(instance), button) ??
        String(instance.record.buttons.nextId++);

    unsent.set(id, button);

    return { text, callback_data: `${instance.id}:${id}` };
}

export function findPressedButton(
    instance: TelegramSceneInstance,
    press: TelegramButtonPress,
): TelegramButton | undefined {
    return instance.record.buttons.messages.find(
        (message) => message.messageId === press.messageId,
    )?.buttons[press.buttonId];
}

export function rememberSceneButtons(
    instance: TelegramSceneInstance,
    messageId: number,
    markup?: TelegramMessageMarkup,
): void {
    const buttons = Object.fromEntries(
        readOwnButtonIds(instance, markup).flatMap((id) => {
            const button = instance.unsentButtons.get(id);

            return button ? [[id, button]] : [];
        }),
    );
    const state = instance.record.buttons;
    const otherMessages = state.messages.filter(
        (message) => message.messageId !== messageId,
    );

    state.messages = Object.keys(buttons).length
        ? [...otherMessages, { messageId, buttons }]
        : otherMessages;
}

export function isConfirming(
    instance: TelegramSceneInstance,
    name: string,
    ...value: [] | [unknown]
): boolean {
    const { confirming } = instance.record;

    return (
        confirming?.name === name &&
        (!value.length ||
            JSON.stringify(confirming.value) === JSON.stringify(value[0]))
    );
}

export function confirmSceneButton(
    instance: TelegramSceneInstance,
    { name, value, armed }: TelegramSceneButton,
): boolean {
    if (armed && isConfirming(instance, name, value)) {
        cancelConfirmation(instance);
        return true;
    }

    instance.record.confirming = { name, value };
    return false;
}

export function cancelConfirmation(instance: TelegramSceneInstance): void {
    instance.record.confirming = undefined;
}

export function forgetInputButtons(instance: TelegramSceneInstance): void {
    const state = instance.record.buttons;

    state.messages = state.messages.flatMap((message) => {
        const buttons = Object.fromEntries(
            Object.entries(message.buttons).filter(
                ([, button]) => button.kind !== "input",
            ),
        );

        return Object.keys(buttons).length
            ? [{ messageId: message.messageId, buttons }]
            : [];
    });
}

function storedButtonsOf(
    instance: TelegramSceneInstance,
): [string, TelegramButton][] {
    return instance.record.buttons.messages.flatMap((message) =>
        Object.entries(message.buttons),
    );
}

function findSameButton(
    buttons: Iterable<[string, TelegramButton]>,
    button: TelegramButton,
): string | undefined {
    const value = JSON.stringify(button);

    for (const [id, other] of buttons) {
        if (JSON.stringify(other) === value) {
            return id;
        }
    }
}

function readOwnButtonIds(
    instance: TelegramSceneInstance,
    markup?: TelegramMessageMarkup,
): string[] {
    if (!markup || !("inline_keyboard" in markup)) {
        return [];
    }

    const prefix = `${instance.id}:`;

    return markup.inline_keyboard.flat().flatMap((button) => {
        return "callback_data" in button &&
            button.callback_data.startsWith(prefix)
            ? [button.callback_data.slice(prefix.length)]
            : [];
    });
}
