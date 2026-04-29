import { Type } from "@sinclair/typebox";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import {
    buildTelegramChannelPostUpdate,
    buildTelegramPrivateChat,
    buildTelegramTextMessageUpdate,
} from "../../../test/telegram-fixtures.js";
import { resolveTelegramWebhookUrl } from "./telegram-bot-service.js";

let databaseName!: string;
let mongoClient!: MongoClient;
let mongo!: Db;

const webhookGuardSchema = Type.Boolean();

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

        await telegramBotService.setWebhook();

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
            await cache.getJson("telegram:webhook:set", webhookGuardSchema),
            true,
        );
    });

    void it("skips setting the webhook when the one-hour guard already exists", async (t) => {
        const { cache, telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await cache.setJson("telegram:webhook:set", true, 3600);

        await telegramBotService.setWebhook();

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

        await assert.rejects(() => telegramBotService.setWebhook(), {
            message: "Failed to set telegram webhook: bad webhook",
        });
        assert.equal(
            await cache.getJson("telegram:webhook:set", webhookGuardSchema),
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

        await assert.rejects(() => telegramBotService.setWebhook(), {
            message: "network failure",
        });
        assert.equal(
            await cache.getJson("telegram:webhook:set", webhookGuardSchema),
            undefined,
        );
    });

    void it("creates a banned user from a new Telegram user update", async (t) => {
        const { telegramBotService, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramBotService.handleUpdate(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654321,
                    }),
                    text: "hello",
                },
            }),
        );

        const user = await usersRepository.findOneByTelegramId("987654321");

        assert.ok(user);
        assert.equal(user.telegramId, "987654321");
        assert.equal(user.isBanned, true);
    });

    void it("doesn't send pong for a newly created banned user", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramBotService.handleUpdate(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654322,
                    }),
                    text: "ping",
                },
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 0);
    });

    void it("sends pong for an existing unbanned Telegram user", async (t) => {
        const { telegramApiService, telegramBotService, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654323",
            isBanned: false,
        });

        await telegramBotService.handleUpdate(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654323,
                    }),
                    text: "ping",
                },
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 1);
        assert.deepEqual(
            telegramApiService.sendMessage.mock.calls[0]?.arguments,
            [
                {
                    chat_id: 987654323,
                    text: "pong",
                },
            ],
        );
    });

    void it("doesn't send pong for an existing banned Telegram user", async (t) => {
        const { telegramApiService, telegramBotService, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654324",
            isBanned: true,
        });

        await telegramBotService.handleUpdate(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654324,
                    }),
                    text: "ping",
                },
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 0);
    });

    void it("doesn't send pong on other text messages for an existing unbanned user", async (t) => {
        const { telegramApiService, telegramBotService, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654325",
            isBanned: false,
        });

        await telegramBotService.handleUpdate(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654325,
                    }),
                    text: "hello",
                },
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 0);
    });

    void it("doesn't send pong when ping is marked as a command for an existing unbanned user", async (t) => {
        const { telegramApiService, telegramBotService, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654326",
            isBanned: false,
        });

        await telegramBotService.handleUpdate(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654326,
                    }),
                    entities: [
                        {
                            length: 4,
                            offset: 0,
                            type: "bot_command",
                        },
                    ],
                    text: "ping",
                },
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 0);
    });

    void it("skips updates without a Telegram user", async (t) => {
        const { telegramApiService, telegramBotService } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramBotService.handleUpdate(
            buildTelegramChannelPostUpdate({
                from: undefined,
                text: "ping",
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 0);
        assert.equal(await mongo.collection("users").countDocuments(), 0);
    });
});
