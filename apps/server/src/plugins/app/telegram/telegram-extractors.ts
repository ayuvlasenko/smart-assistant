import { Chat, ChatBoostSource, Update, User } from "@grammyjs/types";

export interface TelegramCommand {
    name: string;
    payload: string;
}

export function extractTelegramUser(update: Update): User | undefined {
    return (
        update.message?.from ??
        update.edited_message?.from ??
        update.business_connection?.user ??
        update.business_message?.from ??
        update.edited_business_message?.from ??
        update.message_reaction?.user ??
        update.inline_query?.from ??
        update.chosen_inline_result?.from ??
        update.callback_query?.from ??
        update.shipping_query?.from ??
        update.pre_checkout_query?.from ??
        update.poll_answer?.user ??
        update.my_chat_member?.from ??
        update.chat_member?.from ??
        update.managed_bot?.user ??
        update.chat_join_request?.from ??
        extractChatBoostUser(update.chat_boost?.boost.source) ??
        extractChatBoostUser(update.removed_chat_boost?.source) ??
        update.purchased_paid_media?.from
    );
}

export function extractTelegramUpdateType(update: Update): string {
    return Object.keys(update).find((key) => key !== "update_id") ?? "unknown";
}

export function extractTelegramChat(update: Update): Chat | undefined {
    return (
        update.message?.chat ??
        update.edited_message?.chat ??
        update.business_message?.chat ??
        update.edited_business_message?.chat ??
        update.callback_query?.message?.chat ??
        update.message_reaction?.chat ??
        update.message_reaction_count?.chat ??
        update.my_chat_member?.chat ??
        update.chat_member?.chat ??
        update.chat_join_request?.chat ??
        update.chat_boost?.chat ??
        update.removed_chat_boost?.chat
    );
}

export function extractTelegramCommand(
    update: Update,
): TelegramCommand | undefined {
    const message = update.message;

    if (!message?.text) {
        return;
    }

    const first = message.entities?.[0];
    if (first?.type !== "bot_command" || first.offset !== 0) {
        return;
    }

    const [name] = message.text.slice(1, first.length).split("@");

    if (!name) {
        return;
    }

    return {
        name,
        payload: message.text.slice(first.length).trim(),
    };
}

function extractChatBoostUser(source?: ChatBoostSource): User | undefined {
    return source?.user;
}
