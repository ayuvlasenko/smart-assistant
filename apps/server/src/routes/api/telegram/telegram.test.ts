import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    REQUEST_ID_HEADER,
    TELEGRAM_SECRET_HEADER,
} from "../../../constants/headers.js";
import { TelegramBotService } from "../../../plugins/app/telegram/telegram-bot-service.js";
import { buildTestApp } from "../../../test/helper.js";
import { createLogCollector } from "../../../test/log-collector.js";
import {
    buildTelegramPrivateChat,
    buildTelegramTextMessageUpdate,
    buildTelegramWebhookHeaders,
} from "../../../test/telegram-fixtures.js";

interface ErrorResponse {
    code?: string;
    error?: string;
    message?: string;
    statusCode?: number;
}

void describe("POST /api/telegram/webhook", () => {
    void it("returns 200 on valid secret", async (t) => {
        const { app } = await buildTestApp({ t });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            headers: buildTelegramWebhookHeaders(),
            body: buildTelegramTextMessageUpdate({
                message: {
                    text: "hello",
                },
            }),
        });

        assert.equal(response.statusCode, 200);
    });

    void it("returns 401 on invalid secret", async (t) => {
        const { app } = await buildTestApp({ t });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            headers: buildTelegramWebhookHeaders("invalid-secret"),
            body: buildTelegramTextMessageUpdate(),
        });

        assert.equal(response.statusCode, 401);
        assert.deepEqual(response.json(), {
            message: "Unauthorized",
            error: "Unauthorized",
            statusCode: 401,
        });
    });

    void it("returns 400 when secret header is missing", async (t) => {
        const { app } = await buildTestApp({ t });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            body: buildTelegramTextMessageUpdate(),
        });

        const body = response.json<ErrorResponse>();

        assert.equal(response.statusCode, 400);
        assert.equal(body.code, "FST_ERR_VALIDATION");
        assert.equal(body.error, "Bad Request");
        assert.ok(body.message?.includes(TELEGRAM_SECRET_HEADER));
        assert.equal(body.statusCode, 400);
    });

    void it("logs request id when update handling throws", async (t) => {
        const logs = createLogCollector();
        const { app } = await buildTestApp({
            logger: logs.logger,
            t,
        });
        const telegramBotService =
            app.getDecorator<TelegramBotService>("telegramBotService");

        t.mock.method(telegramBotService, "handleUpdate", async () => {
            throw new Error("Telegram update failed");
        });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            headers: buildTelegramWebhookHeaders(),
            body: buildTelegramTextMessageUpdate({
                message: {
                    text: "ping",
                },
            }),
        });

        const responseRequestId = response.headers[REQUEST_ID_HEADER];
        const unhandledErrorLog = logs
            .readEntries()
            .find((entry) => entry.msg === "Unhandled error occurred");

        assert.equal(response.statusCode, 500);
        assert.ok(typeof responseRequestId === "string");
        assert.ok(unhandledErrorLog);
        assert.equal(unhandledErrorLog.reqId, responseRequestId);
    });

    void it("writes service logs with the request id during a real webhook request", async (t) => {
        const logs = createLogCollector();
        const { app } = await buildTestApp({
            logger: logs.logger,
            t,
        });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            headers: buildTelegramWebhookHeaders(),
            body: buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654327,
                    }),
                    text: "hello",
                },
            }),
        });

        const responseRequestId = response.headers[REQUEST_ID_HEADER];
        const receivedUpdateLog = logs
            .readEntries()
            .find((entry) => entry.msg === "Received update");

        assert.equal(response.statusCode, 200);
        assert.ok(typeof responseRequestId === "string");
        assert.ok(receivedUpdateLog);
        assert.equal(receivedUpdateLog.reqId, responseRequestId);
    });
});
