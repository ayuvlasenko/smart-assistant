import { CallbackQuery, Message, Update } from "@grammyjs/types";
import { TelegramUpdateFilter } from "./telegram-context.js";

export type TelegramTextMessageUpdate = Omit<
    Update,
    "callback_query" | "message"
> & {
    callback_query?: never;
    message: Message.TextMessage & Update.NonChannel;
};

// eslint-disable-next-line sonarjs/redundant-type-aliases -- Intentional public filter-result name.
export type TelegramCommandMessageUpdate = TelegramTextMessageUpdate;

export type TelegramCallbackQueryUpdate = Omit<
    Update,
    "callback_query" | "message"
> & {
    callback_query: CallbackQuery;
    message?: never;
};

export type TelegramCallbackDataQueryUpdate = Omit<
    Update,
    "callback_query" | "message"
> & {
    callback_query: CallbackQuery & { data: string };
    message?: never;
};

export function message(
    key: "text",
): TelegramUpdateFilter<TelegramTextMessageUpdate> {
    return (update): update is TelegramTextMessageUpdate => {
        if (!hasTextMessage(update) || !(key in update.message)) {
            return false;
        }

        return !command()(update);
    };
}

export function command(
    name?: string,
): TelegramUpdateFilter<TelegramCommandMessageUpdate> {
    return (update): update is TelegramCommandMessageUpdate => {
        if (!hasTextMessage(update)) {
            return false;
        }

        const first = update.message.entities?.[0];
        if (first?.type !== "bot_command") {
            return false;
        }

        if (first.offset !== 0) {
            return false;
        }

        const [commandPart] = update.message.text
            .slice(0, first.length)
            .split("@");

        if (!commandPart) {
            return false;
        }

        const commandName = commandPart.slice(1);

        return !name || commandName === name;
    };
}

export function callbackQuery(): TelegramUpdateFilter<TelegramCallbackQueryUpdate>;
export function callbackQuery(
    key: "data",
): TelegramUpdateFilter<TelegramCallbackDataQueryUpdate>;
export function callbackQuery(
    key?: "data",
): TelegramUpdateFilter<
    TelegramCallbackDataQueryUpdate | TelegramCallbackQueryUpdate
> {
    return (
        update,
    ): update is
        | TelegramCallbackDataQueryUpdate
        | TelegramCallbackQueryUpdate => {
        if (!update.callback_query) {
            return false;
        }

        if (!key) {
            return true;
        }

        return typeof update.callback_query.data === "string";
    };
}

function hasTextMessage(update: Update): update is TelegramTextMessageUpdate {
    return !!(update.message && "text" in update.message);
}
