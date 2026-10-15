import { Type } from "@sinclair/typebox";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildTestApp } from "../../../test/helper.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramBotServiceTestApp,
    BuildTelegramBotServiceTestAppOptions,
} from "../../../test/telegram-bot-service-helper.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
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

void describe("TelegramBotService chat commands", () => {
    void it("keeps guarded commands out of the menu on start", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramBotService.setCommandsOnStart();

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls[0]?.arguments[0]
                .commands,
            buildExpectedCommands("en"),
        );
    });

    void it("sets the commands that the user's grants allow in the user's language for the chat", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramBotService.syncCommands(
            buildUserEntity({
                telegramId: "987654601",
                languageCode: "uk",
                grants: ["vip"],
            }),
        );
        await telegramBotService.syncCommands(
            buildUserEntity({ telegramId: "987654602" }),
        );

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments,
            ),
            [
                [
                    {
                        commands: [
                            ...buildExpectedCommands("uk"),
                            {
                                command: "secret",
                                description: telegramLocales.uk.error,
                            },
                        ],
                        scope: { type: "chat", chat_id: 987654601 },
                    },
                ],
                [
                    {
                        commands: buildExpectedCommands("en"),
                        scope: { type: "chat", chat_id: 987654602 },
                    },
                ],
            ],
        );
    });

    void it("sets the chat commands again only when they change", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));
        const user = buildUserEntity({ telegramId: "987654603" });

        await telegramBotService.syncCommands(user);
        await telegramBotService.syncCommands(user);
        await telegramBotService.syncCommands({ ...user, grants: ["vip"] });
        await telegramBotService.syncCommands({ ...user, languageCode: "ru" });

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments[0].commands.length,
            ),
            [2, 3, 2],
        );
    });

    void it("doesn't set chat commands for banned users", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramBotService.syncCommands(
            buildUserEntity({ telegramId: "987654604", isBanned: true }),
        );

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 0);
    });

    void it("sets the chat commands on preview again after the webhook is refreshed", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                ...buildMenuAppOptions(t),
                environment: "preview",
            });
        const user = buildUserEntity({ telegramId: "987654605" });
        const readScopes = () =>
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments[0].scope?.type ?? "default",
            );

        await telegramBotService.syncCommands(user);
        await telegramBotService.syncCommands(user);

        assert.deepEqual(readScopes(), ["chat"]);

        await telegramBotService.refreshWebhook();
        await telegramBotService.syncCommands(user);
        await telegramBotService.syncCommands(user);

        assert.deepEqual(readScopes(), [
            "chat",
            "default",
            "default",
            "default",
            "default",
            "chat",
        ]);
    });

    void it("logs a rejected chat menu, keeps going and tries again next time", async (t) => {
        const logs = createLogCollector();
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const { telegramBotService } = await buildTelegramBotServiceTestApp({
            ...buildMenuAppOptions(t),
            telegramApiService,
            logger: logs.logger,
        });
        const user = buildUserEntity({ telegramId: "987654606" });

        telegramApiService.setMyCommands.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request",
            }),
        );

        await telegramBotService.syncCommands(user);
        await telegramBotService.syncCommands(user);

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 2);
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) =>
                        entry.msg === "Failed to set telegram chat commands",
                ),
        );
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

function buildMenuAppOptions(
    t: BuildTelegramBotServiceTestAppOptions["t"],
): BuildTelegramBotServiceTestAppOptions {
    return {
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router) => {
            router.command("help", async () => undefined, {
                description: (translate) => translate("telegram:unknown"),
            });
            router.command("secret", async () => undefined, {
                description: (translate) => translate("telegram:error"),
                guard: (user) => user.grants.includes("vip"),
            });
        },
    };
}

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
