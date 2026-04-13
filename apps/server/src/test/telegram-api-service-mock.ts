import { ApiResponse, UserFromGetMe } from "@grammyjs/types";
import { Mock, TestContext } from "node:test";
import {
    TelegramApiClient,
    TelegramMethodResult,
} from "../plugins/app/telegram/telegram-api-service.js";
import {
    buildTelegramGetMeResponse,
    buildTelegramSendMessageResponse,
    buildTelegramSetWebhookResponse,
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
}

export function buildTelegramApiServiceMock({
    t,
    ...opts
}: BuildTelegramApiServiceMockOptions): TelegramApiServiceMock {
    return {
        setWebhook: t.mock.fn(
            async () =>
                opts.setWebhookResponse ?? buildTelegramSetWebhookResponse(),
        ),
        sendMessage: t.mock.fn(
            async () =>
                opts.sendMessageResponse ?? buildTelegramSendMessageResponse(),
        ),
        getMe: t.mock.fn(
            async () => opts.getMeResponse ?? buildTelegramGetMeResponse(),
        ),
    };
}
