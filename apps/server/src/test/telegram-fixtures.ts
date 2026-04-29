import {
    ApiResponse,
    BusinessConnection,
    BusinessMessagesDeleted,
    CallbackQuery,
    Chat,
    ChatBoostRemoved,
    ChatBoostUpdated,
    ChatJoinRequest,
    ChatMemberMember,
    ChatMemberUpdated,
    ChosenInlineResult,
    InlineQuery,
    ManagedBotUpdated,
    Message,
    MessageReactionCountUpdated,
    MessageReactionUpdated,
    PaidMediaPurchased,
    Poll,
    PollAnswer,
    PreCheckoutQuery,
    ShippingAddress,
    ShippingQuery,
    Update,
    User,
    UserFromGetMe,
} from "@grammyjs/types";
import { TELEGRAM_SECRET_HEADER } from "../constants/headers.js";
import { TelegramMethodResult } from "../plugins/app/telegram/telegram-api-service.js";

export type TelegramTextMessage = Message.TextMessage & Update.NonChannel;
export type TelegramChannelTextMessage = Message.TextMessage & Update.Channel;
export type TelegramBusinessTextMessage = Message.TextMessage & Update.Private;

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

export function buildTelegramEditedMessageUpdate(
    overrides: Partial<TelegramTextMessage & Update.Edited> = {},
): Update & {
    edited_message: TelegramTextMessage & Update.Edited;
} {
    const { edit_date, ...messageOverrides } = overrides;

    return buildTelegramUpdate("edited_message", {
        ...buildTelegramTextMessage(messageOverrides),
        edit_date: edit_date ?? 1776076900,
    });
}

export function buildTelegramChannelPostUpdate(
    overrides: Partial<TelegramChannelTextMessage> = {},
): Update & {
    channel_post: TelegramChannelTextMessage;
} {
    return buildTelegramUpdate(
        "channel_post",
        buildTelegramChannelTextMessage(overrides),
    );
}

export function buildTelegramEditedChannelPostUpdate(
    overrides: Partial<TelegramChannelTextMessage & Update.Edited> = {},
): Update & {
    edited_channel_post: TelegramChannelTextMessage & Update.Edited;
} {
    const { edit_date, ...messageOverrides } = overrides;

    return buildTelegramUpdate("edited_channel_post", {
        ...buildTelegramChannelTextMessage(messageOverrides),
        edit_date: edit_date ?? 1776076900,
    });
}

export function buildTelegramBusinessConnectionUpdate(
    overrides: Partial<BusinessConnection> = {},
): Update & {
    business_connection: BusinessConnection;
} {
    return buildTelegramUpdate("business_connection", {
        id: "business-connection-1",
        user: buildTelegramUser(),
        user_chat_id: 1,
        date: 1776076800,
        is_enabled: true,
        ...overrides,
    });
}

export function buildTelegramBusinessMessageUpdate(
    overrides: Partial<TelegramBusinessTextMessage> = {},
): Update & {
    business_message: TelegramBusinessTextMessage;
} {
    return buildTelegramUpdate(
        "business_message",
        buildTelegramBusinessTextMessage(overrides),
    );
}

export function buildTelegramEditedBusinessMessageUpdate(
    overrides: Partial<TelegramBusinessTextMessage & Update.Edited> = {},
): Update & {
    edited_business_message: TelegramBusinessTextMessage & Update.Edited;
} {
    const { edit_date, ...messageOverrides } = overrides;

    return buildTelegramUpdate("edited_business_message", {
        ...buildTelegramBusinessTextMessage(messageOverrides),
        edit_date: edit_date ?? 1776076900,
    });
}

export function buildTelegramDeletedBusinessMessagesUpdate(
    overrides: Partial<BusinessMessagesDeleted> = {},
): Update & {
    deleted_business_messages: BusinessMessagesDeleted;
} {
    return buildTelegramUpdate("deleted_business_messages", {
        business_connection_id: "business-connection-1",
        chat: buildTelegramPrivateChat(),
        message_ids: [1],
        ...overrides,
    });
}

export function buildTelegramMessageReactionUpdate(
    overrides: Partial<MessageReactionUpdated> = {},
): Update & {
    message_reaction: MessageReactionUpdated;
} {
    return buildTelegramUpdate("message_reaction", {
        chat: buildTelegramPrivateChat(),
        message_id: 1,
        user: buildTelegramUser(),
        date: 1776076800,
        old_reaction: [],
        new_reaction: [
            {
                type: "emoji",
                emoji: "👍",
            },
        ],
        ...overrides,
    });
}

export function buildTelegramMessageReactionCountUpdate(
    overrides: Partial<MessageReactionCountUpdated> = {},
): Update & {
    message_reaction_count: MessageReactionCountUpdated;
} {
    return buildTelegramUpdate("message_reaction_count", {
        chat: buildTelegramPrivateChat(),
        message_id: 1,
        date: 1776076800,
        reactions: [
            {
                type: {
                    type: "emoji",
                    emoji: "👍",
                },
                total_count: 1,
            },
        ],
        ...overrides,
    });
}

export function buildTelegramInlineQueryUpdate(
    overrides: Partial<InlineQuery> = {},
): Update & {
    inline_query: InlineQuery;
} {
    return buildTelegramUpdate("inline_query", {
        id: "inline-query-1",
        from: buildTelegramUser(),
        query: "ping",
        offset: "",
        ...overrides,
    });
}

export function buildTelegramChosenInlineResultUpdate(
    overrides: Partial<ChosenInlineResult> = {},
): Update & {
    chosen_inline_result: ChosenInlineResult;
} {
    return buildTelegramUpdate("chosen_inline_result", {
        result_id: "inline-result-1",
        from: buildTelegramUser(),
        query: "ping",
        ...overrides,
    });
}

export function buildTelegramCallbackQueryUpdate(
    overrides: Partial<CallbackQuery> = {},
): Update & {
    callback_query: CallbackQuery;
} {
    return buildTelegramUpdate("callback_query", {
        id: "callback-query-1",
        from: buildTelegramUser(),
        chat_instance: "chat-instance-1",
        data: "callback-data",
        ...overrides,
    });
}

export function buildTelegramShippingQueryUpdate(
    overrides: Partial<ShippingQuery> = {},
): Update & {
    shipping_query: ShippingQuery;
} {
    return buildTelegramUpdate("shipping_query", {
        id: "shipping-query-1",
        from: buildTelegramUser(),
        invoice_payload: "shipping-payload",
        shipping_address: buildTelegramShippingAddress(),
        ...overrides,
    });
}

export function buildTelegramPreCheckoutQueryUpdate(
    overrides: Partial<PreCheckoutQuery> = {},
): Update & {
    pre_checkout_query: PreCheckoutQuery;
} {
    return buildTelegramUpdate("pre_checkout_query", {
        id: "pre-checkout-query-1",
        from: buildTelegramUser(),
        currency: "USD",
        total_amount: 100,
        invoice_payload: "checkout-payload",
        ...overrides,
    });
}

export function buildTelegramPollUpdate(
    overrides: Partial<Poll> = {},
): Update & {
    poll: Poll;
} {
    return buildTelegramUpdate("poll", buildTelegramPoll(overrides));
}

export function buildTelegramPollAnswerUpdate(
    overrides: Partial<PollAnswer> = {},
): Update & {
    poll_answer: PollAnswer;
} {
    return buildTelegramUpdate("poll_answer", {
        poll_id: "poll-1",
        user: buildTelegramUser(),
        option_ids: [0],
        option_persistent_ids: ["option-1"],
        ...overrides,
    });
}

export function buildTelegramMyChatMemberUpdate(
    overrides: Partial<ChatMemberUpdated> = {},
): Update & {
    my_chat_member: ChatMemberUpdated;
} {
    return buildTelegramUpdate(
        "my_chat_member",
        buildTelegramChatMemberUpdated(overrides),
    );
}

export function buildTelegramChatMemberUpdate(
    overrides: Partial<ChatMemberUpdated> = {},
): Update & {
    chat_member: ChatMemberUpdated;
} {
    return buildTelegramUpdate(
        "chat_member",
        buildTelegramChatMemberUpdated(overrides),
    );
}

export function buildTelegramManagedBotUpdate(
    overrides: Partial<ManagedBotUpdated> = {},
): Update & {
    managed_bot: ManagedBotUpdated;
} {
    return buildTelegramUpdate("managed_bot", {
        user: buildTelegramUser(),
        bot: buildTelegramBotUser({
            id: 2,
            first_name: "Managed Bot",
            username: "managed-bot",
        }),
        ...overrides,
    });
}

export function buildTelegramChatJoinRequestUpdate(
    overrides: Partial<ChatJoinRequest> = {},
): Update & {
    chat_join_request: ChatJoinRequest;
} {
    return buildTelegramUpdate("chat_join_request", {
        chat: buildTelegramSupergroupChat(),
        from: buildTelegramUser(),
        user_chat_id: 1,
        date: 1776076800,
        ...overrides,
    });
}

export function buildTelegramChatBoostUpdate(
    overrides: Partial<ChatBoostUpdated> = {},
): Update & {
    chat_boost: ChatBoostUpdated;
} {
    return buildTelegramUpdate("chat_boost", {
        chat: buildTelegramSupergroupChat(),
        boost: {
            boost_id: "boost-1",
            add_date: 1776076800,
            expiration_date: 1776080400,
            source: {
                source: "premium",
                user: buildTelegramUser(),
            },
        },
        ...overrides,
    });
}

export function buildTelegramRemovedChatBoostUpdate(
    overrides: Partial<ChatBoostRemoved> = {},
): Update & {
    removed_chat_boost: ChatBoostRemoved;
} {
    return buildTelegramUpdate("removed_chat_boost", {
        chat: buildTelegramSupergroupChat(),
        boost_id: "boost-1",
        remove_date: 1776076800,
        source: {
            source: "premium",
            user: buildTelegramUser(),
        },
        ...overrides,
    });
}

export function buildTelegramPurchasedPaidMediaUpdate(
    overrides: Partial<PaidMediaPurchased> = {},
): Update & {
    purchased_paid_media: PaidMediaPurchased;
} {
    return buildTelegramUpdate("purchased_paid_media", {
        from: buildTelegramUser(),
        paid_media_payload: "paid-media-payload",
        ...overrides,
    });
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

export function buildTelegramChannelTextMessage(
    overrides: Partial<TelegramChannelTextMessage> = {},
): TelegramChannelTextMessage {
    const {
        chat: customChat,
        from: customFrom,
        ...messageOverrides
    } = overrides;
    const chat = customChat ?? buildTelegramChannelChat();
    const from =
        "from" in overrides
            ? customFrom
            : buildTelegramUser({
                  id: 2,
                  first_name: "channel-user",
                  username: "channel-user",
              });

    return {
        message_id: 1,
        date: 1776076800,
        chat,
        ...(from ? { from } : {}),
        text: "channel ping",
        ...messageOverrides,
    };
}

export function buildTelegramBusinessTextMessage(
    overrides: Partial<TelegramBusinessTextMessage> = {},
): TelegramBusinessTextMessage {
    const {
        chat: customChat,
        from: customFrom,
        ...messageOverrides
    } = overrides;
    const chat = customChat ?? buildTelegramPrivateChat();
    const from =
        "from" in overrides
            ? customFrom
            : buildTelegramUser({
                  id: chat.id,
                  username: chat.username,
                  first_name: chat.first_name,
              });

    return {
        message_id: 1,
        date: 1776076800,
        chat,
        ...(from ? { from } : {}),
        text: "business ping",
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

export function buildTelegramSupergroupChat(
    overrides: Partial<Chat.SupergroupChat> = {},
): Chat.SupergroupChat {
    return {
        id: -1001,
        type: "supergroup",
        title: "supergroup",
        ...overrides,
    };
}

export function buildTelegramChannelChat(
    overrides: Partial<Chat.ChannelChat> = {},
): Chat.ChannelChat {
    return {
        id: -1002,
        type: "channel",
        title: "channel",
        ...overrides,
    };
}

export function buildTelegramPoll(overrides: Partial<Poll> = {}): Poll {
    return {
        id: "poll-1",
        question: "What is your favorite bot response?",
        options: [
            {
                persistent_id: "option-1",
                text: "pong",
                voter_count: 1,
            },
        ],
        total_voter_count: 1,
        is_closed: false,
        is_anonymous: false,
        type: "regular",
        allows_multiple_answers: false,
        allows_revoting: false,
        ...overrides,
    };
}

export function buildTelegramShippingAddress(
    overrides: Partial<ShippingAddress> = {},
): ShippingAddress {
    return {
        country_code: "US",
        state: "CA",
        city: "San Francisco",
        street_line1: "1 Market St",
        street_line2: "Suite 1",
        post_code: "94105",
        ...overrides,
    };
}

export function buildTelegramChatMember(
    overrides: Partial<ChatMemberMember> = {},
): ChatMemberMember {
    return {
        status: "member",
        user: buildTelegramUser(),
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

export function buildTelegramBotUser(overrides: Partial<User> = {}): User {
    return buildTelegramUser({
        id: 999,
        is_bot: true,
        first_name: "bot",
        username: "bot",
        ...overrides,
    });
}

export function buildTelegramChatMemberUpdated(
    overrides: Partial<ChatMemberUpdated> = {},
): ChatMemberUpdated {
    const member =
        overrides.new_chat_member?.user ??
        overrides.old_chat_member?.user ??
        buildTelegramUser({
            id: 3,
            first_name: "member",
            username: "member",
        });

    return {
        chat: buildTelegramSupergroupChat(),
        from: buildTelegramUser({
            id: 2,
            first_name: "actor",
            username: "actor",
        }),
        date: 1776076800,
        old_chat_member: buildTelegramChatMember({
            user: member,
        }),
        new_chat_member: buildTelegramChatMember({
            user: member,
        }),
        ...overrides,
    };
}

function buildTelegramUpdate<
    TKey extends Exclude<keyof Update, "update_id">,
    TValue extends NonNullable<Update[TKey]>,
>(
    key: TKey,
    value: TValue,
    update_id = 1,
): Update & { [Key in TKey]-?: TValue } {
    return {
        update_id,
        [key]: value,
    } as unknown as Update & { [Key in TKey]-?: TValue };
}
