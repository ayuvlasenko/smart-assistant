import { ChatBoostSource, Update, User } from "@grammyjs/types";

export function extractTelegramUser(update: Update): User | undefined {
    return (
        extractMessageUser(update.message) ??
        extractMessageUser(update.edited_message) ??
        update.channel_post?.from ??
        update.edited_channel_post?.from ??
        update.business_connection?.user ??
        extractMessageUser(update.business_message) ??
        extractMessageUser(update.edited_business_message) ??
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

function extractMessageUser(message?: {
    from?: User;
    sender_chat?: object;
}): User | undefined {
    if (message?.sender_chat) {
        return;
    }

    return message?.from;
}

function extractChatBoostUser(source?: ChatBoostSource): User | undefined {
    return source?.user;
}
