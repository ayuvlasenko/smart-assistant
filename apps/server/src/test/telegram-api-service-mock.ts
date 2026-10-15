import { ApiResponse, UserFromGetMe } from "@grammyjs/types";
import { Mock, TestContext } from "node:test";
import {
    TelegramApiClient,
    TelegramMethodResult,
} from "../plugins/app/telegram/telegram-api-service.js";
import {
    buildTelegramGetMeResponse,
    buildTelegramSendMessageResponse,
    buildTelegramSentMessageResponse,
    buildTelegramSetWebhookResponse,
    buildTelegramTrueResponse,
} from "./telegram-fixtures.js";

interface BuildTelegramApiServiceMockOptions {
    t: TestContext;
    setWebhookResponse?: ApiResponse<TelegramMethodResult<"setWebhook">>;
    sendMessageResponse?: ApiResponse<TelegramMethodResult<"sendMessage">>;
    getMeResponse?: ApiResponse<UserFromGetMe>;
}

export interface TelegramApiServiceMock extends TelegramApiClient {
    setWebhook: Mock<TelegramApiClient["setWebhook"]>;
    sendMessage: Mock<TelegramApiClient["sendMessage"]>;
    getMe: Mock<TelegramApiClient["getMe"]>;
    answerCallbackQuery: Mock<TelegramApiClient["answerCallbackQuery"]>;
    setMyCommands: Mock<TelegramApiClient["setMyCommands"]>;
    editMessageReplyMarkup: Mock<TelegramApiClient["editMessageReplyMarkup"]>;
    deleteMessages: Mock<TelegramApiClient["deleteMessages"]>;
    deleteMessage: Mock<TelegramApiClient["deleteMessage"]>;
    sendRichMessage: Mock<TelegramApiClient["sendRichMessage"]>;
    sendPhoto: Mock<TelegramApiClient["sendPhoto"]>;
    sendVideo: Mock<TelegramApiClient["sendVideo"]>;
    sendDocument: Mock<TelegramApiClient["sendDocument"]>;
    sendAnimation: Mock<TelegramApiClient["sendAnimation"]>;
    sendAudio: Mock<TelegramApiClient["sendAudio"]>;
    editMessageText: Mock<TelegramApiClient["editMessageText"]>;
    editMessageMedia: Mock<TelegramApiClient["editMessageMedia"]>;
}

export function buildTelegramApiServiceMock({
    t,
    ...opts
}: BuildTelegramApiServiceMockOptions): TelegramApiServiceMock {
    let sentMessageCount = 0;
    const nextMessageId = () => {
        sentMessageCount += 1;

        return sentMessageCount;
    };

    return {
        setWebhook: t.mock.fn(
            async () =>
                opts.setWebhookResponse ?? buildTelegramSetWebhookResponse(),
        ),
        sendMessage: t.mock.fn(async () => {
            const messageId = nextMessageId();

            return (
                opts.sendMessageResponse ??
                buildTelegramSendMessageResponse({ message_id: messageId })
            );
        }),
        getMe: t.mock.fn(
            async () => opts.getMeResponse ?? buildTelegramGetMeResponse(),
        ),
        answerCallbackQuery: t.mock.fn(async () => buildTelegramTrueResponse()),
        setMyCommands: t.mock.fn(async () => buildTelegramTrueResponse()),
        editMessageReplyMarkup: t.mock.fn(async () =>
            buildTelegramTrueResponse(),
        ),
        deleteMessages: t.mock.fn(async () => buildTelegramTrueResponse()),
        deleteMessage: t.mock.fn(async () => buildTelegramTrueResponse()),
        sendRichMessage: t.mock.fn(async () =>
            buildTelegramSentMessageResponse(
                "sendRichMessage",
                nextMessageId(),
            ),
        ),
        sendPhoto: t.mock.fn(async () =>
            buildTelegramSentMessageResponse("sendPhoto", nextMessageId()),
        ),
        sendVideo: t.mock.fn(async () =>
            buildTelegramSentMessageResponse("sendVideo", nextMessageId()),
        ),
        sendDocument: t.mock.fn(async () =>
            buildTelegramSentMessageResponse("sendDocument", nextMessageId()),
        ),
        sendAnimation: t.mock.fn(async () =>
            buildTelegramSentMessageResponse("sendAnimation", nextMessageId()),
        ),
        sendAudio: t.mock.fn(async () =>
            buildTelegramSentMessageResponse("sendAudio", nextMessageId()),
        ),
        editMessageText: t.mock.fn(async () => buildTelegramTrueResponse()),
        editMessageMedia: t.mock.fn(async () => buildTelegramTrueResponse()),
    };
}
