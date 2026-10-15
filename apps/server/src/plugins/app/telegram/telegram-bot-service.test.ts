import { Type } from "@sinclair/typebox";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildTestApp } from "../../../test/helper.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import { Language } from "../i18n-service.js";
import { resolveTelegramWebhookUrl } from "./telegram-bot-service.js";
import { telegramLocales } from "./telegram-locales.js";

let databaseName!: string;
let mongoClient!: MongoClient;
let mongo!: Db;

const webhookClaimSchema = Type.String();

before(async () => {
    const testMongo = await buildTestMongo();

    databaseName = testMongo.databaseName;
    mongoClient = testMongo.client;
    mongo = testMongo.mongo;
});

beforeEach(async () => {
    await mongo.collection("users").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

void describe("TelegramBotService", () => {
    void it("builds a resource-specific webhook URL when no explicit override is set", () => {
        const webhookUrl = resolveTelegramWebhookUrl({
            DOMAIN: "https://smart-assistant.bambom.org",
            RESOURCE_NAME: "pr-123",
        });

        assert.equal(
            webhookUrl,
            "https://smart-assistant.bambom.org/api/telegram/webhook/pr-123",
        );
    });

    void it("uses the explicit webhook URL override when it is present", () => {
        const webhookUrl = resolveTelegramWebhookUrl({
            DOMAIN: "https://smart-assistant.bambom.org",
            RESOURCE_NAME: "pr-123",
            TELEGRAM_WEBHOOK_URL:
                "https://proxy3020.bambom.org/api/telegram/webhook/custom",
        });

        assert.equal(
            webhookUrl,
            "https://proxy3020.bambom.org/api/telegram/webhook/custom",
        );
    });

    void it("sets the webhook and stores the one-hour guard when the cache key is missing", async (t) => {
        const { app, cache, telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramBotService.setWebhookOnStart();

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 1);
        assert.deepEqual(
            telegramApiService.setWebhook.mock.calls[0]?.arguments,
            [
                {
                    url: resolveTelegramWebhookUrl(app.config),
                    secret_token: app.config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
                },
            ],
        );
        assert.equal(
            typeof (await cache.get(
                "telegram:webhook:set",
                webhookClaimSchema,
            )),
            "string",
        );
    });

    void it("skips setting the webhook when the one-hour guard already exists", async (t) => {
        const { cache, telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await cache.set("telegram:webhook:set", "other-pod", {
            ttlMilliseconds: 3_600_000,
        });

        await telegramBotService.setWebhookOnStart();

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 0);
    });

    void it("removes the guard and throws when Telegram rejects webhook setup", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({
            t,
            setWebhookResponse: {
                ok: false,
                error_code: 400,
                description: "bad webhook",
            },
        });
        const { cache, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                telegramApiService,
            });

        await assert.rejects(() => telegramBotService.setWebhookOnStart(), {
            message: "Failed to set telegram webhook: bad webhook",
        });
        assert.equal(
            await cache.get("telegram:webhook:set", webhookClaimSchema),
            undefined,
        );
    });

    void it("removes the guard and propagates errors when the webhook request fails", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({ t });
        telegramApiService.setWebhook.mock.mockImplementationOnce(async () => {
            throw new Error("network failure");
        });
        const { cache, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                telegramApiService,
            });

        await assert.rejects(() => telegramBotService.setWebhookOnStart(), {
            message: "network failure",
        });
        assert.equal(
            await cache.get("telegram:webhook:set", webhookClaimSchema),
            undefined,
        );
    });

    void it("doesn't set the webhook on start in preview", async (t) => {
        const { cache, telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                environment: "preview",
            });

        await telegramBotService.setWebhookOnStart();

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 0);
        assert.equal(
            await cache.get("telegram:webhook:set", webhookClaimSchema),
            undefined,
        );
    });

    void it("sets the webhook on every direct call without touching the guard", async (t) => {
        const { app, cache, telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await cache.set("telegram:webhook:set", "other-pod", {
            ttlMilliseconds: 3_600_000,
        });

        const firstUrl = await telegramBotService.setWebhook();
        const secondUrl = await telegramBotService.setWebhook();

        assert.equal(firstUrl, resolveTelegramWebhookUrl(app.config));
        assert.equal(secondUrl, firstUrl);
        assert.equal(telegramApiService.setWebhook.mock.callCount(), 2);
        assert.equal(
            await cache.get("telegram:webhook:set", webhookClaimSchema),
            "other-pod",
        );
    });
});

void describe("TelegramBotService commands on start", () => {
    void it("sets localized commands for every language on production", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.command("help", async () => undefined, {
                        description: (translate) =>
                            translate("telegram:unknown"),
                    });
                },
            });

        await telegramBotService.setCommandsOnStart();

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments,
            ),
            [
                [{ commands: buildExpectedCommands("en") }],
                ...(["en", "uk", "ru"] as const).map((language) => [
                    {
                        commands: buildExpectedCommands(language),
                        language_code: language,
                    },
                ]),
            ],
        );
    });

    void it("doesn't touch commands on preview", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                environment: "preview",
            });

        await telegramBotService.setCommandsOnStart();

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 0);
    });
});

void describe("telegram plugin on listen", () => {
    void it("sets the webhook once on production", async (t) => {
        const logs = createLogCollector();
        const { app, telegramApiService } = await buildTestApp({
            t,
            environment: "production",
            logger: logs.logger,
        });

        await app.listen({ port: 0, host: "127.0.0.1" });
        await logs.waitForEntry(
            (entry) => entry.msg === "Telegram commands set successfully",
        );

        assert.equal(telegramApiService.getMe.mock.callCount(), 0);
        assert.equal(telegramApiService.setWebhook.mock.callCount(), 1);
        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 4);
    });

    void it("reports the skipped webhook on preview", async (t) => {
        const logs = createLogCollector();
        const { app } = await buildTestApp({
            t,
            environment: "preview",
            logger: logs.logger,
        });

        await app.listen({ port: 0, host: "127.0.0.1" });
        const skipEntry = await logs.waitForEntry(
            (entry) =>
                entry.msg ===
                "Telegram webhook is not set on preview start, claim it with POST /api/telegram/webhook/refresh",
        );

        assert.equal(skipEntry.module, "telegram");
    });
});

function buildExpectedCommands(language: Language) {
    return [
        {
            command: "cancel",
            description: telegramLocales[language].cancelCommand,
        },
        {
            command: "help",
            description: telegramLocales[language].unknown,
        },
    ];
}
