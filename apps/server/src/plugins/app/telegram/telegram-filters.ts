import { CallbackQuery, Message, Update } from "@grammyjs/types";
import { extractTelegramCommand } from "./telegram-extractors.js";

export type TelegramUpdateFilter<TUpdate extends Update> = (
    update: Update,
) => update is TUpdate;

export type GuardedTelegramUpdate<TFilter> =
    TFilter extends TelegramUpdateFilter<infer TUpdate> ? TUpdate : never;

export type GuardedTelegramUpdates<
    TFilters extends readonly TelegramUpdateFilter<Update>[],
> = GuardedTelegramUpdate<TFilters[number]>;

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

export function text(
    value: string,
): TelegramUpdateFilter<TelegramTextMessageUpdate> {
    const isTextMessage = message("text");

    return (update): update is TelegramTextMessageUpdate =>
        isTextMessage(update) && update.message.text === value;
}

export function anyOf<TUpdates extends Update[]>(
    ...filters: {
        [Key in keyof TUpdates]: TelegramUpdateFilter<TUpdates[Key]>;
    }
): TelegramUpdateFilter<TUpdates[number]> {
    return (update): update is TUpdates[number] =>
        filters.some((filter) => filter(update));
}

export function command(
    name?: string,
): TelegramUpdateFilter<TelegramCommandMessageUpdate> {
    return (update): update is TelegramCommandMessageUpdate => {
        const parsedCommand = extractTelegramCommand(update);

        return !!parsedCommand && (!name || parsedCommand.name === name);
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
        TelegramCallbackDataQueryUpdate | TelegramCallbackQueryUpdate => {
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
