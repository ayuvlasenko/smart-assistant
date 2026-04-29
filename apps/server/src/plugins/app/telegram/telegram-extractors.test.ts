import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildTelegramBusinessConnectionUpdate,
    buildTelegramBusinessMessageUpdate,
    buildTelegramCallbackQueryUpdate,
    buildTelegramChannelPostUpdate,
    buildTelegramChatBoostUpdate,
    buildTelegramChatJoinRequestUpdate,
    buildTelegramChatMember,
    buildTelegramChatMemberUpdate,
    buildTelegramChosenInlineResultUpdate,
    buildTelegramDeletedBusinessMessagesUpdate,
    buildTelegramEditedBusinessMessageUpdate,
    buildTelegramEditedChannelPostUpdate,
    buildTelegramEditedMessageUpdate,
    buildTelegramInlineQueryUpdate,
    buildTelegramManagedBotUpdate,
    buildTelegramMessageReactionCountUpdate,
    buildTelegramMessageReactionUpdate,
    buildTelegramMyChatMemberUpdate,
    buildTelegramPollAnswerUpdate,
    buildTelegramPollUpdate,
    buildTelegramPreCheckoutQueryUpdate,
    buildTelegramPurchasedPaidMediaUpdate,
    buildTelegramRemovedChatBoostUpdate,
    buildTelegramShippingQueryUpdate,
    buildTelegramSupergroupChat,
    buildTelegramTextMessageUpdate,
    buildTelegramUser,
} from "../../../test/telegram-fixtures.js";
import { extractTelegramUser } from "./telegram-extractors.js";

void describe("extractUser", () => {
    void it("extracts the relevant user from update types that carry one", async (t) => {
        const cases = [
            {
                name: "message",
                expected: buildTelegramUser({
                    id: 101,
                    first_name: "message-user",
                    username: "message-user",
                }),
                update: buildTelegramTextMessageUpdate({
                    message: {
                        from: buildTelegramUser({
                            id: 101,
                            first_name: "message-user",
                            username: "message-user",
                        }),
                    },
                }),
            },
            {
                name: "edited_message",
                expected: buildTelegramUser({
                    id: 102,
                    first_name: "edited-message-user",
                    username: "edited-message-user",
                }),
                update: buildTelegramEditedMessageUpdate({
                    from: buildTelegramUser({
                        id: 102,
                        first_name: "edited-message-user",
                        username: "edited-message-user",
                    }),
                }),
            },
            {
                name: "channel_post",
                expected: buildTelegramUser({
                    id: 103,
                    first_name: "channel-post-user",
                    username: "channel-post-user",
                }),
                update: buildTelegramChannelPostUpdate({
                    from: buildTelegramUser({
                        id: 103,
                        first_name: "channel-post-user",
                        username: "channel-post-user",
                    }),
                }),
            },
            {
                name: "edited_channel_post",
                expected: buildTelegramUser({
                    id: 104,
                    first_name: "edited-channel-post-user",
                    username: "edited-channel-post-user",
                }),
                update: buildTelegramEditedChannelPostUpdate({
                    from: buildTelegramUser({
                        id: 104,
                        first_name: "edited-channel-post-user",
                        username: "edited-channel-post-user",
                    }),
                }),
            },
            {
                name: "business_connection",
                expected: buildTelegramUser({
                    id: 105,
                    first_name: "business-connection-user",
                    username: "business-connection-user",
                }),
                update: buildTelegramBusinessConnectionUpdate({
                    user: buildTelegramUser({
                        id: 105,
                        first_name: "business-connection-user",
                        username: "business-connection-user",
                    }),
                }),
            },
            {
                name: "business_message",
                expected: buildTelegramUser({
                    id: 106,
                    first_name: "business-message-user",
                    username: "business-message-user",
                }),
                update: buildTelegramBusinessMessageUpdate({
                    from: buildTelegramUser({
                        id: 106,
                        first_name: "business-message-user",
                        username: "business-message-user",
                    }),
                }),
            },
            {
                name: "edited_business_message",
                expected: buildTelegramUser({
                    id: 107,
                    first_name: "edited-business-message-user",
                    username: "edited-business-message-user",
                }),
                update: buildTelegramEditedBusinessMessageUpdate({
                    from: buildTelegramUser({
                        id: 107,
                        first_name: "edited-business-message-user",
                        username: "edited-business-message-user",
                    }),
                }),
            },
            {
                name: "message_reaction",
                expected: buildTelegramUser({
                    id: 108,
                    first_name: "message-reaction-user",
                    username: "message-reaction-user",
                }),
                update: buildTelegramMessageReactionUpdate({
                    user: buildTelegramUser({
                        id: 108,
                        first_name: "message-reaction-user",
                        username: "message-reaction-user",
                    }),
                }),
            },
            {
                name: "inline_query",
                expected: buildTelegramUser({
                    id: 109,
                    first_name: "inline-query-user",
                    username: "inline-query-user",
                }),
                update: buildTelegramInlineQueryUpdate({
                    from: buildTelegramUser({
                        id: 109,
                        first_name: "inline-query-user",
                        username: "inline-query-user",
                    }),
                }),
            },
            {
                name: "chosen_inline_result",
                expected: buildTelegramUser({
                    id: 110,
                    first_name: "chosen-inline-result-user",
                    username: "chosen-inline-result-user",
                }),
                update: buildTelegramChosenInlineResultUpdate({
                    from: buildTelegramUser({
                        id: 110,
                        first_name: "chosen-inline-result-user",
                        username: "chosen-inline-result-user",
                    }),
                }),
            },
            {
                name: "callback_query",
                expected: buildTelegramUser({
                    id: 111,
                    first_name: "callback-query-user",
                    username: "callback-query-user",
                }),
                update: buildTelegramCallbackQueryUpdate({
                    from: buildTelegramUser({
                        id: 111,
                        first_name: "callback-query-user",
                        username: "callback-query-user",
                    }),
                }),
            },
            {
                name: "shipping_query",
                expected: buildTelegramUser({
                    id: 112,
                    first_name: "shipping-query-user",
                    username: "shipping-query-user",
                }),
                update: buildTelegramShippingQueryUpdate({
                    from: buildTelegramUser({
                        id: 112,
                        first_name: "shipping-query-user",
                        username: "shipping-query-user",
                    }),
                }),
            },
            {
                name: "pre_checkout_query",
                expected: buildTelegramUser({
                    id: 113,
                    first_name: "pre-checkout-query-user",
                    username: "pre-checkout-query-user",
                }),
                update: buildTelegramPreCheckoutQueryUpdate({
                    from: buildTelegramUser({
                        id: 113,
                        first_name: "pre-checkout-query-user",
                        username: "pre-checkout-query-user",
                    }),
                }),
            },
            {
                name: "poll_answer",
                expected: buildTelegramUser({
                    id: 114,
                    first_name: "poll-answer-user",
                    username: "poll-answer-user",
                }),
                update: buildTelegramPollAnswerUpdate({
                    user: buildTelegramUser({
                        id: 114,
                        first_name: "poll-answer-user",
                        username: "poll-answer-user",
                    }),
                }),
            },
            {
                name: "my_chat_member",
                expected: buildTelegramUser({
                    id: 115,
                    first_name: "my-chat-member-actor",
                    username: "my-chat-member-actor",
                }),
                update: buildTelegramMyChatMemberUpdate({
                    from: buildTelegramUser({
                        id: 115,
                        first_name: "my-chat-member-actor",
                        username: "my-chat-member-actor",
                    }),
                    new_chat_member: buildTelegramChatMember({
                        user: buildTelegramUser({
                            id: 215,
                            first_name: "my-chat-member-target",
                            username: "my-chat-member-target",
                        }),
                    }),
                }),
            },
            {
                name: "chat_member",
                expected: buildTelegramUser({
                    id: 116,
                    first_name: "chat-member-actor",
                    username: "chat-member-actor",
                }),
                update: buildTelegramChatMemberUpdate({
                    from: buildTelegramUser({
                        id: 116,
                        first_name: "chat-member-actor",
                        username: "chat-member-actor",
                    }),
                    new_chat_member: buildTelegramChatMember({
                        user: buildTelegramUser({
                            id: 216,
                            first_name: "chat-member-target",
                            username: "chat-member-target",
                        }),
                    }),
                }),
            },
            {
                name: "managed_bot",
                expected: buildTelegramUser({
                    id: 117,
                    first_name: "managed-bot-owner",
                    username: "managed-bot-owner",
                }),
                update: buildTelegramManagedBotUpdate({
                    user: buildTelegramUser({
                        id: 117,
                        first_name: "managed-bot-owner",
                        username: "managed-bot-owner",
                    }),
                    bot: buildTelegramUser({
                        id: 217,
                        is_bot: true,
                        first_name: "managed-bot",
                        username: "managed-bot",
                    }),
                }),
            },
            {
                name: "chat_join_request",
                expected: buildTelegramUser({
                    id: 118,
                    first_name: "chat-join-request-user",
                    username: "chat-join-request-user",
                }),
                update: buildTelegramChatJoinRequestUpdate({
                    from: buildTelegramUser({
                        id: 118,
                        first_name: "chat-join-request-user",
                        username: "chat-join-request-user",
                    }),
                }),
            },
            {
                name: "chat_boost",
                expected: buildTelegramUser({
                    id: 119,
                    first_name: "chat-boost-user",
                    username: "chat-boost-user",
                }),
                update: buildTelegramChatBoostUpdate({
                    boost: {
                        boost_id: "boost-1",
                        add_date: 1776076800,
                        expiration_date: 1776080400,
                        source: {
                            source: "premium",
                            user: buildTelegramUser({
                                id: 119,
                                first_name: "chat-boost-user",
                                username: "chat-boost-user",
                            }),
                        },
                    },
                }),
            },
            {
                name: "removed_chat_boost",
                expected: buildTelegramUser({
                    id: 120,
                    first_name: "removed-chat-boost-user",
                    username: "removed-chat-boost-user",
                }),
                update: buildTelegramRemovedChatBoostUpdate({
                    source: {
                        source: "gift_code",
                        user: buildTelegramUser({
                            id: 120,
                            first_name: "removed-chat-boost-user",
                            username: "removed-chat-boost-user",
                        }),
                    },
                }),
            },
            {
                name: "purchased_paid_media",
                expected: buildTelegramUser({
                    id: 121,
                    first_name: "paid-media-user",
                    username: "paid-media-user",
                }),
                update: buildTelegramPurchasedPaidMediaUpdate({
                    from: buildTelegramUser({
                        id: 121,
                        first_name: "paid-media-user",
                        username: "paid-media-user",
                    }),
                }),
            },
        ];

        for (const { name, expected, update } of cases) {
            await t.test(name, () => {
                assert.deepEqual(extractTelegramUser(update), expected);
            });
        }
    });

    void it("returns undefined for update types that do not carry a user", async (t) => {
        const cases = [
            {
                name: "deleted_business_messages",
                update: buildTelegramDeletedBusinessMessagesUpdate(),
            },
            {
                name: "message_reaction_count",
                update: buildTelegramMessageReactionCountUpdate(),
            },
            {
                name: "poll",
                update: buildTelegramPollUpdate(),
            },
        ];

        for (const { name, update } of cases) {
            await t.test(name, () => {
                assert.equal(extractTelegramUser(update), undefined);
            });
        }
    });

    void it("returns undefined when an update uses an anonymous chat instead of a user", async (t) => {
        const cases = [
            {
                name: "channel_post",
                update: buildTelegramChannelPostUpdate({
                    from: undefined,
                }),
            },
            {
                name: "message with sender_chat",
                update: buildTelegramTextMessageUpdate({
                    message: {
                        from: buildTelegramUser({
                            id: 122,
                            first_name: "fake-message-user",
                            username: "fake-message-user",
                        }),
                        sender_chat: buildTelegramSupergroupChat(),
                    },
                }),
            },
            {
                name: "edited_message with sender_chat",
                update: buildTelegramEditedMessageUpdate({
                    from: buildTelegramUser({
                        id: 123,
                        first_name: "fake-edited-message-user",
                        username: "fake-edited-message-user",
                    }),
                    sender_chat: buildTelegramSupergroupChat(),
                }),
            },
            {
                name: "business_message with sender_chat",
                update: buildTelegramBusinessMessageUpdate({
                    from: buildTelegramUser({
                        id: 124,
                        first_name: "fake-business-message-user",
                        username: "fake-business-message-user",
                    }),
                    sender_chat: buildTelegramSupergroupChat(),
                }),
            },
            {
                name: "edited_business_message with sender_chat",
                update: buildTelegramEditedBusinessMessageUpdate({
                    from: buildTelegramUser({
                        id: 125,
                        first_name: "fake-edited-business-message-user",
                        username: "fake-edited-business-message-user",
                    }),
                    sender_chat: buildTelegramSupergroupChat(),
                }),
            },
            {
                name: "message_reaction",
                update: buildTelegramMessageReactionUpdate({
                    user: undefined,
                    actor_chat: buildTelegramSupergroupChat(),
                }),
            },
            {
                name: "poll_answer",
                update: buildTelegramPollAnswerUpdate({
                    user: undefined,
                    voter_chat: buildTelegramSupergroupChat(),
                }),
            },
            {
                name: "chat_boost",
                update: buildTelegramChatBoostUpdate({
                    boost: {
                        boost_id: "boost-1",
                        add_date: 1776076800,
                        expiration_date: 1776080400,
                        source: {
                            source: "giveaway",
                            giveaway_message_id: 1,
                            is_unclaimed: true,
                        },
                    },
                }),
            },
            {
                name: "removed_chat_boost",
                update: buildTelegramRemovedChatBoostUpdate({
                    source: {
                        source: "giveaway",
                        giveaway_message_id: 1,
                        is_unclaimed: true,
                    },
                }),
            },
        ];

        for (const { name, update } of cases) {
            await t.test(name, () => {
                assert.equal(extractTelegramUser(update), undefined);
            });
        }
    });
});
