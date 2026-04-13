import {
    ApiResponse,
    Chat,
    Message,
    Update,
    User,
    UserFromGetMe,
} from "@grammyjs/types";
import { TELEGRAM_SECRET_HEADER } from "../constants/headers.js";
import { TelegramMethodResult } from "../plugins/app/telegram/telegram-api-service.js";

export type TelegramTextMessage = Message.TextMessage & Update.NonChannel;

export interface TelegramTextMessageUpdate {
    update_id: number;
    message: TelegramTextMessage;
}

export type BuildTelegramTextMessageOptions = Partial<TelegramTextMessage>;

export interface BuildTelegramTextMessageUpdateOptions {
    update_id?: number;
    message?: BuildTelegramTextMessageOptions;
}

export function buildTelegramTextMessageUpdate(
    options: BuildTelegramTextMessageUpdateOptions = {},
): TelegramTextMessageUpdate {
    return {
        update_id: options.update_id ?? 1,
        message: buildTelegramTextMessage(options.message),
    };
}

export function buildTelegramSendMessageResponse(
    overrides: BuildTelegramTextMessageOptions = {},
): ApiResponse<TelegramMethodResult<"sendMessage">> {
    return {
        ok: true,
        result: buildTelegramTextMessage({
            text: "Ha-ha-ha",
            date: 1776077500,
            ...overrides,
        }),
    };
}

export function buildTelegramTextMessage(
    overrides: BuildTelegramTextMessageOptions = {},
): TelegramTextMessage {
    const {
        chat: customChat,
        from: customFrom,
        ...messageOverrides
    } = overrides;
    const chat = customChat ?? buildTelegramPrivateChat();
    const from =
        customFrom ??
        buildTelegramUser({
            id: chat.id,
            username: chat.username,
            first_name: chat.first_name,
        });

    return {
        message_id: 1,
        date: 1776076800,
        chat,
        from,
        text: "ping",
        ...messageOverrides,
    };
}

export function buildTelegramSetWebhookResponse(
    result: TelegramMethodResult<"setWebhook"> = true,
): ApiResponse<TelegramMethodResult<"setWebhook">> {
    return {
        ok: true,
        result,
    };
}

export function buildTelegramGetMeResponse(
    overrides: Partial<UserFromGetMe> = {},
): ApiResponse<UserFromGetMe> {
    return {
        ok: true,
        result: buildTelegramBotUserFromGetMe(overrides),
    };
}

export function buildTelegramWebhookHeaders(
    secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN ?? "test",
): Record<typeof TELEGRAM_SECRET_HEADER, string> {
    return {
        [TELEGRAM_SECRET_HEADER]: secret,
    };
}

export function buildTelegramBotUserFromGetMe(
    overrides: Partial<UserFromGetMe> = {},
): UserFromGetMe {
    return {
        id: 1,
        first_name: "Bip-Bop Bot",
        is_bot: true,
        username: "bipbopbot",
        can_join_groups: true,
        can_read_all_group_messages: true,
        can_manage_bots: true,
        supports_inline_queries: true,
        can_connect_to_business: true,
        has_main_web_app: true,
        has_topics_enabled: true,
        allows_users_to_create_topics: true,
        ...overrides,
    };
}

export function buildTelegramPrivateChat(
    overrides: Partial<Chat.PrivateChat> = {},
): Chat.PrivateChat {
    return {
        id: 1,
        type: "private",
        username: "user",
        first_name: "user",
        ...overrides,
    };
}

export function buildTelegramUser(overrides: Partial<User> = {}): User {
    return {
        id: 1,
        is_bot: false,
        first_name: "user",
        username: "user",
        language_code: "en",
        ...overrides,
    };
}
