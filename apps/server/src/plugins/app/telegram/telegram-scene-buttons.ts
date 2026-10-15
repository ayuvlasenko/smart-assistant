import {
    ForceReply,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
} from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";

const telegramButtonSchema = Type.Union([
    Type.Object({
        kind: Type.Literal("scene"),
        name: Type.String(),
        value: Type.Unknown(),
    }),
    Type.Object({
        kind: Type.Literal("input"),
        step: Type.String(),
        value: Type.Unknown(),
    }),
]);

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

export class TelegramSceneButtons {
    private readonly unsent = new WeakMap<
        TelegramSceneInstance,
        Map<string, TelegramButton>
    >();

    create(
        instance: TelegramSceneInstance,
        text: string,
        button: TelegramButton,
        reuseFromMessageId?: number,
    ): InlineKeyboardButton.CallbackButton {
        const id =
            findSameButton(instance, button, reuseFromMessageId) ??
            String(instance.record.buttons.nextId++);

        this.unsentIn(instance).set(id, button);

        return { text, callback_data: `${instance.id}:${id}` };
    }

    find(
        instance: TelegramSceneInstance,
        press: TelegramButtonPress,
    ): TelegramButton | undefined {
        return instance.record.buttons.messages.find(
            (message) => message.messageId === press.messageId,
        )?.buttons[press.buttonId];
    }

    remember(
        instance: TelegramSceneInstance,
        messageId: number,
        markup?: TelegramMessageMarkup,
    ): void {
        const unsent = this.unsentIn(instance);
        const buttons = Object.fromEntries(
            readOwnButtonIds(instance, markup).flatMap((id) => {
                const button = unsent.get(id);

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

    forgetInputButtons(instance: TelegramSceneInstance): void {
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

    private unsentIn(
        instance: TelegramSceneInstance,
    ): Map<string, TelegramButton> {
        let unsent = this.unsent.get(instance);

        if (!unsent) {
            unsent = new Map();
            this.unsent.set(instance, unsent);
        }

        return unsent;
    }
}

function findSameButton(
    instance: TelegramSceneInstance,
    button: TelegramButton,
    messageId: number | undefined,
): string | undefined {
    const buttons = instance.record.buttons.messages.find(
        (message) => message.messageId === messageId,
    )?.buttons;
    const value = JSON.stringify(button);

    return Object.entries(buttons ?? {}).find(
        ([, stored]) => JSON.stringify(stored) === value,
    )?.[0];
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
