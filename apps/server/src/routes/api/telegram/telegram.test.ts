import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    REQUEST_ID_HEADER,
    TELEGRAM_SECRET_HEADER,
} from "../../../constants/headers.js";
import { resolveTelegramWebhookUrl } from "../../../plugins/app/telegram/telegram-bot-service.js";
import { TelegramUpdateHandler } from "../../../plugins/app/telegram/telegram-update-handler.js";
import { buildTestApp } from "../../../test/helper.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
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

    void it("returns 200 and logs the error with the request id when update handling throws", async (t) => {
        const logs = createLogCollector();
        const { app } = await buildTestApp({
            logger: logs.logger,
            t,
        });
        const telegramUpdateHandler = app.getDecorator<TelegramUpdateHandler>(
            "telegramUpdateHandler",
        );

        t.mock.method(telegramUpdateHandler, "handle", async () => {
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
        const updateErrorLog = logs
            .readEntries()
            .find((entry) => entry.msg === "Failed to handle Telegram update");

        assert.equal(response.statusCode, 200);
        assert.ok(typeof responseRequestId === "string");
        assert.ok(updateErrorLog);
        assert.equal(updateErrorLog.reqId, responseRequestId);
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

    void it("doesn't write the message text to the logs", async (t) => {
        const logs = createLogCollector();
        const { app } = await buildTestApp({
            logger: logs.logger,
            t,
        });

        await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            headers: buildTelegramWebhookHeaders(),
            body: buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654394,
                    }),
                    entities: [{ length: 6, offset: 0, type: "bot_command" }],
                    text: "/start secret-invite-token",
                },
            }),
        });

        const logOutput = JSON.stringify(logs.readEntries());

        assert.ok(logOutput.includes("Received update"));
        assert.ok(!logOutput.includes("secret-invite-token"));
    });
});

void describe("POST /api/telegram/webhook/refresh", () => {
    void it("points the webhook at this environment on preview", async (t) => {
        const { app, telegramApiService } = await buildTestApp({
            t,
            environment: "preview",
        });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook/refresh",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), {
            webhookUrl: resolveTelegramWebhookUrl(app.config),
            botUrl: "https://t.me/bipbopbot",
        });
        assert.deepEqual(
            telegramApiService.setWebhook.mock.calls.map(
                (call) => call.arguments,
            ),
            [
                [
                    {
                        url: resolveTelegramWebhookUrl(app.config),
                        secret_token: app.config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
                    },
                ],
            ],
        );
    });

    void it("sets the webhook on every refresh and looks the bot up once", async (t) => {
        const { app, telegramApiService } = await buildTestApp({
            t,
            environment: "preview",
        });

        await app.inject({
            method: "POST",
            url: "/api/telegram/webhook/refresh",
        });
        await app.inject({
            method: "POST",
            url: "/api/telegram/webhook/refresh",
        });

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 2);
        assert.equal(telegramApiService.getMe.mock.callCount(), 1);
    });

    void it("returns 500 when Telegram rejects the webhook", async (t) => {
        const { app } = await buildTestApp({
            t,
            environment: "preview",
            telegramApiService: buildTelegramApiServiceMock({
                t,
                setWebhookResponse: {
                    ok: false,
                    error_code: 400,
                    description: "bad webhook",
                },
            }),
        });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook/refresh",
        });

        assert.equal(response.statusCode, 500);
    });

    void it("keeps the webhook when the bot lookup fails", async (t) => {
        const { app, telegramApiService } = await buildTestApp({
            t,
            environment: "preview",
            telegramApiService: buildTelegramApiServiceMock({
                t,
                getMeResponse: {
                    ok: false,
                    error_code: 401,
                    description: "Unauthorized",
                },
            }),
        });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook/refresh",
        });

        assert.equal(response.statusCode, 500);
        assert.equal(telegramApiService.setWebhook.mock.callCount(), 0);
    });

    void it("is not registered on production", async (t) => {
        const { app, telegramApiService } = await buildTestApp({
            t,
            environment: "production",
        });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook/refresh",
        });

        assert.equal(response.statusCode, 404);
        assert.equal(telegramApiService.setWebhook.mock.callCount(), 0);
    });
});
