import { FastifyInstance } from "fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Env } from "../../../env.js";
import { buildTestApp } from "../../../test/helper.js";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramBotServiceTestApp,
    buildTwoBotsTestApp,
} from "../../../test/telegram-bot-service-helper.js";
import {
    testBotId,
    testTelegramBotId,
} from "../../../test/telegram-fixtures.js";
import { resolveTelegramWebhookUrl } from "./telegram-bot-service.js";
import { telegramWebhookSecret } from "./telegram-webhook-secret.js";

const testMongo = useTestMongo();

void describe("TelegramBotService", () => {
    void it("builds a resource-specific webhook URL of the bot when no explicit override is set", () => {
        const webhookUrl = resolveTelegramWebhookUrl(
            {
                DOMAIN: "https://smart-assistant.bambom.org",
                RESOURCE_NAME: "pr-123",
            },
            "42",
        );

        assert.equal(
            webhookUrl,
            "https://smart-assistant.bambom.org/api/telegram/webhook/pr-123/42",
        );
    });

    void it("appends the Telegram id to the explicit webhook URL override", () => {
        const webhookUrl = resolveTelegramWebhookUrl(
            {
                DOMAIN: "https://smart-assistant.bambom.org",
                RESOURCE_NAME: "pr-123",
                TELEGRAM_WEBHOOK_URL:
                    "https://proxy3020.bambom.org/api/telegram/webhook/",
            },
            "42",
        );

        assert.equal(
            webhookUrl,
            "https://proxy3020.bambom.org/api/telegram/webhook/42",
        );
    });

    void it("sets the webhook on start once per hour across the pods of a resource", async (t) => {
        const { app, telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });
        const otherPod = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            env: { RESOURCE_NAME: resourceNameOf(app) },
        });

        await telegramBotService.setUpOnStart();
        await otherPod.telegramBotService.setUpOnStart();

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 1);
        assert.deepEqual(
            telegramApiService.setWebhook.mock.calls[0]?.arguments,
            [
                {
                    url: resolveTelegramWebhookUrl(
                        app.getDecorator<Env>("config"),
                        testTelegramBotId,
                    ),
                    secret_token: telegramWebhookSecret(
                        app.getDecorator<Env>("config")
                            .TELEGRAM_WEBHOOK_SECRET_TOKEN,
                        testTelegramBotId,
                    ),
                },
            ],
        );
        assert.equal(
            otherPod.telegramApiService.setWebhook.mock.callCount(),
            0,
        );
    });

    void it("sets the webhook on start again when its secret or URL changed within the hour", async (t) => {
        const first = await buildTelegramBotServiceTestApp({ testMongo, t });
        const resourceName = resourceNameOf(first.app);
        const newSecret = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            env: {
                RESOURCE_NAME: resourceName,
                TELEGRAM_WEBHOOK_SECRET_TOKEN: "rotated_secret",
            },
        });
        const newUrl = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            env: {
                RESOURCE_NAME: resourceName,
                TELEGRAM_WEBHOOK_URL:
                    "https://moved.example/api/telegram/webhook",
            },
        });

        await first.telegramBotService.setUpOnStart();
        await newSecret.telegramBotService.setUpOnStart();
        await newUrl.telegramBotService.setUpOnStart();

        assert.equal(
            newSecret.telegramApiService.setWebhook.mock.callCount(),
            1,
        );
        assert.equal(newUrl.telegramApiService.setWebhook.mock.callCount(), 1);
    });

    void it("sets the webhook on start again after a rollback to a config of the same hour", async (t) => {
        const first = await buildTelegramBotServiceTestApp({ testMongo, t });
        const resourceName = resourceNameOf(first.app);
        const rotated = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            env: {
                RESOURCE_NAME: resourceName,
                TELEGRAM_WEBHOOK_SECRET_TOKEN: "rotated_secret",
            },
        });
        const rolledBack = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            env: { RESOURCE_NAME: resourceName },
        });

        await first.telegramBotService.setUpOnStart();
        await rotated.telegramBotService.setUpOnStart();
        await rolledBack.telegramBotService.setUpOnStart();

        assert.equal(
            rolledBack.telegramApiService.setWebhook.mock.callCount(),
            1,
        );
    });

    void it("logs the bot and tries again on the next start when Telegram rejects the webhook", async (t) => {
        const logs = createLoggerCollector();
        const telegramApiService = buildTelegramApiServiceMock({
            t,
            setWebhookResponse: {
                ok: false,
                error_code: 400,
                description: "bad webhook",
            },
        });
        const { telegramBotService } = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            telegramApiService,
            logger: logs.logger,
        });

        await telegramBotService.setUpOnStart();
        await telegramBotService.setUpOnStart();

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 2);
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) =>
                        entry.msg ===
                            "Failed to set the webhook of a bot on start" &&
                        entry.botId === testBotId,
                ),
        );
    });

    void it("tries again on the next start when the webhook request fails", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({ t });
        telegramApiService.setWebhook.mock.mockImplementationOnce(async () => {
            throw new Error("network failure");
        });
        const { telegramBotService } = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            telegramApiService,
        });

        await telegramBotService.setUpOnStart();
        await telegramBotService.setUpOnStart();

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 2);
    });

    void it("sets the webhooks of the other bots when one bot fails", async (t) => {
        const failing = buildTelegramApiServiceMock({
            t,
            setWebhookResponse: {
                ok: false,
                error_code: 401,
                description: "Unauthorized",
            },
        });
        const { child, telegramBotService } = await buildTwoBotsTestApp({
            testMongo,
            t,
            telegramApiService: failing,
        });

        await telegramBotService.setUpOnStart();

        assert.equal(failing.setWebhook.mock.callCount(), 1);
        assert.equal(child.setWebhook.mock.callCount(), 1);
    });

    void it("refreshes the other bots when one bot fails and reports each bot", async (t) => {
        const failing = buildTelegramApiServiceMock({
            t,
            getMeResponse: {
                ok: false,
                error_code: 401,
                description: "Unauthorized",
            },
        });
        const { child, childBotId, telegramBotService } =
            await buildTwoBotsTestApp({
                testMongo,
                t,
                telegramApiService: failing,
                environment: "preview",
            });

        const webhooks = await telegramBotService.refreshWebhooks();

        assert.deepEqual(
            webhooks.map(({ botId, status }) => ({ botId, status })),
            [
                { botId: testBotId, status: "failed" },
                { botId: childBotId, status: "refreshed" },
            ],
        );
        assert.equal(failing.setWebhook.mock.callCount(), 0);
        assert.equal(child.setWebhook.mock.callCount(), 1);
    });

    void it("reports a network failure of a bot without its details", async (t) => {
        const failing = buildTelegramApiServiceMock({ t });

        failing.getMe.mock.mockImplementation(async () => {
            throw new Error("connect ECONNREFUSED api.telegram.org");
        });

        const { telegramBotService } = await buildTwoBotsTestApp({
            testMongo,
            t,
            telegramApiService: failing,
            environment: "preview",
        });

        assert.deepEqual((await telegramBotService.refreshWebhooks())[0], {
            botId: testBotId,
            status: "failed",
            error: "Telegram request failed",
        });
    });

    void it("doesn't set the webhook on start in preview", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                environment: "preview",
            });

        await telegramBotService.setUpOnStart();

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 0);
    });

    void it("sets the webhook on every direct call, also within the hour of a start", async (t) => {
        const { app, telegramApiService, telegramBotService, telegramBots } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });

        await telegramBotService.setUpOnStart();

        const firstUrl = await telegramBotService.setWebhook(
            await telegramBots.root(),
        );
        const secondUrl = await telegramBotService.setWebhook(
            await telegramBots.root(),
        );

        assert.equal(
            firstUrl,
            resolveTelegramWebhookUrl(
                app.getDecorator<Env>("config"),
                testTelegramBotId,
            ),
        );
        assert.equal(secondUrl, firstUrl);
        assert.equal(telegramApiService.setWebhook.mock.callCount(), 3);
    });
});

void describe("telegram plugin on listen", () => {
    void it("sets the webhook once on production", async (t) => {
        const logs = createLoggerCollector();
        const { app, telegramApiService } = await buildTestApp({
            t,
            environment: "production",
            logger: logs.logger,
        });

        await app.listen({ port: 0, host: "127.0.0.1" });
        await Promise.all([
            logs.waitForEntry(
                (entry) => entry.msg === "Telegram webhook set successfully",
            ),
            logs.waitForEntry(
                (entry) => entry.msg === "Telegram commands set successfully",
            ),
        ]);

        assert.equal(telegramApiService.getMe.mock.callCount(), 0);
        assert.equal(telegramApiService.setWebhook.mock.callCount(), 1);
        assert.equal(telegramApiService.deleteMyCommands.mock.callCount(), 4);
    });

    void it("reports the skipped webhook on preview", async (t) => {
        const logs = createLoggerCollector();
        const { app } = await buildTestApp({
            t,
            environment: "preview",
            logger: logs.logger,
        });

        await app.listen({ port: 0, host: "127.0.0.1" });
        const skipEntry = await logs.waitForEntry(
            (entry) =>
                entry.msg ===
                "Telegram webhooks are not set on preview start, claim them with POST /api/telegram/webhook/refresh",
        );

        assert.equal(skipEntry.module, "telegram");
    });
});

function resourceNameOf(app: FastifyInstance): string {
    return app.getDecorator<Env>("config").RESOURCE_NAME;
}
