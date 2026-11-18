import { CallbackQuery, Message, Update } from "@grammyjs/types";
import Fastify from "fastify";
import i18next from "i18next";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramCallbackQueryUpdate,
    buildTelegramPrivateChat,
    buildTelegramTextMessageUpdate,
} from "../../../test/telegram-fixtures.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { I18nService } from "../i18n-service.js";
import { TelegramContext } from "./telegram-context.js";
import { extractTelegramChat } from "./telegram-extractors.js";
import { TelegramUpdateFilter } from "./telegram-filters.js";
import { TelegramResponder } from "./telegram-responder.js";
import { TelegramSession } from "./telegram-session.js";

type TestTextMessageUpdate = Omit<Update, "callback_query" | "message"> & {
    callback_query?: never;
    message: Message.TextMessage & Update.NonChannel;
};

type TestCallbackDataUpdate = Omit<Update, "callback_query" | "message"> & {
    callback_query: CallbackQuery & { data: string };
    message?: never;
};

const textMessageFilter: TelegramUpdateFilter<TestTextMessageUpdate> = (
    update,
): update is TestTextMessageUpdate => {
    return !!(update.message && "text" in update.message);
};

const callbackDataFilter: TelegramUpdateFilter<TestCallbackDataUpdate> = (
    update,
): update is TestCallbackDataUpdate => {
    return typeof update.callback_query?.data === "string";
};

function expectGuardedUpdateUnion(
    update: TestTextMessageUpdate | TestCallbackDataUpdate,
): TestTextMessageUpdate | TestCallbackDataUpdate {
    return update;
}

function buildContext<TUpdate extends Update>(
    t: TestContext,
    update: TUpdate,
    telegramApiService: TelegramApiServiceMock = buildTelegramApiServiceMock({
        t,
    }),
) {
    const log = Fastify({ logger: false }).log;

    return new TelegramContext({
        update,
        user: buildUserEntity(),
        session: new TelegramSession(
            { getHashField: async () => undefined },
            "telegram:session:test",
        ),
        log,
        translatorOf: ({ languageCode }) =>
            new I18nService(i18next.createInstance()).getT(languageCode),
        timeZone: "UTC",
        responder: new TelegramResponder(
            extractTelegramChat(update)?.id,
            update.callback_query,
            telegramApiService,
            log,
        ),
    });
}

void describe("TelegramContext", () => {
    void it("stores the update", (t) => {
        const update = buildTelegramTextMessageUpdate();
        const context = buildContext(t, update);

        assert.equal(context.update, update);
    });

    void it("takes a newer document of its user, and refuses another user", (t) => {
        const context = buildContext(t, buildTelegramTextMessageUpdate());
        const refreshed = { ...context.user, grants: ["admin"] };

        context.refreshUser(refreshed);

        assert.equal(context.user, refreshed);
        assert.throws(() => {
            context.refreshUser(buildUserEntity());
        }, /can't change its user/);
    });

    void it("narrows update with a single filter", (t) => {
        const context = buildContext(
            t,
            buildTelegramTextMessageUpdate({
                message: {
                    text: "hello",
                },
            }) as Update,
        );

        if (!context.has(textMessageFilter)) {
            assert.fail("Expected text message filter to match");
        }

        assert.equal(context.update.message.text, "hello");
    });

    void it("narrows update with any matching filter from an array", (t) => {
        const context = buildContext(
            t,
            buildTelegramCallbackQueryUpdate({
                data: "choose:today",
            }) as Update,
        );

        if (!context.has([textMessageFilter, callbackDataFilter])) {
            assert.fail("Expected one of the filters to match");
        }

        expectGuardedUpdateUnion(context.update);
        assert.equal(context.update.message?.text, undefined);
        assert.equal(context.update.callback_query?.data, "choose:today");
    });

    void it("returns false when no array filter matches", (t) => {
        const context = buildContext(
            t,
            buildTelegramCallbackQueryUpdate({
                data: undefined,
            }) as Update,
        );

        assert.equal(
            context.has([textMessageFilter, callbackDataFilter]),
            false,
        );
    });

    void it("replies to the chat of the update", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const context = buildContext(
            t,
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654500 }),
                },
            }),
            telegramApiService,
        );

        await context.reply("hello");

        assert.deepEqual(
            telegramApiService.sendMessage.mock.calls.map(
                (call) => call.arguments,
            ),
            [[{ chat_id: 987654500, text: "hello" }]],
        );
    });

    void it("throws when Telegram rejects the reply", async (t) => {
        const context = buildContext(
            t,
            buildTelegramTextMessageUpdate(),
            buildTelegramApiServiceMock({
                t,
                sendMessageResponse: {
                    ok: false,
                    error_code: 403,
                    description: "Forbidden: bot was blocked by the user",
                },
            }),
        );

        await assert.rejects(() => context.reply("hello"), {
            name: "TelegramApiError",
            method: "sendMessage",
            errorCode: 403,
            description: "Forbidden: bot was blocked by the user",
        });
    });

    void it("takes a keyboard that Telegram calls not modified as edited", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const context = buildContext(
            t,
            buildTelegramTextMessageUpdate(),
            telegramApiService,
        );

        telegramApiService.editMessageReplyMarkup.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request: message is not modified",
            }),
        );

        await context.editKeyboard(5, { inline_keyboard: [] });

        assert.equal(
            telegramApiService.editMessageReplyMarkup.mock.callCount(),
            1,
        );
    });

    void it("throws when Telegram rejects the edit of a keyboard", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const context = buildContext(
            t,
            buildTelegramTextMessageUpdate(),
            telegramApiService,
        );

        telegramApiService.editMessageReplyMarkup.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request: message to edit not found",
            }),
        );

        await assert.rejects(
            () => context.editKeyboard(5, { inline_keyboard: [] }),
            {
                name: "TelegramApiError",
                method: "editMessageReplyMarkup",
                errorCode: 400,
            },
        );
    });

    void it("answers the callback query of the update", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const context = buildContext(
            t,
            buildTelegramCallbackQueryUpdate({ id: "callback-query-7" }),
            telegramApiService,
        );

        await context.answerCallbackQuery("done");

        assert.deepEqual(
            telegramApiService.answerCallbackQuery.mock.calls.map(
                (call) => call.arguments,
            ),
            [[{ callback_query_id: "callback-query-7", text: "done" }]],
        );
    });
});
