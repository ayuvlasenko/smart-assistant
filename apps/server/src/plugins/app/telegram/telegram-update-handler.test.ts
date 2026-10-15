import { Type } from "@sinclair/typebox";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { requestLogSerializers } from "../../../constants/options.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { TelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import {
    buildTelegramCallbackQueryUpdate,
    buildTelegramChannelPostUpdate,
    buildTelegramEditedMessageUpdate,
    buildTelegramPollUpdate,
    buildTelegramPrivateChat,
    buildTelegramSupergroupChat,
    buildTelegramTextMessage,
    buildTelegramTextMessageUpdate,
    buildTelegramUser,
} from "../../../test/telegram-fixtures.js";
import {
    buildSessionKey,
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import { Language } from "../i18n-service.js";
import { UsersRepository } from "../users/users-repository.js";
import { text } from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import { defineScene } from "./telegram-scene.js";

let databaseName!: string;
let mongoClient!: MongoClient;
let mongo!: Db;

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

void describe("TelegramUpdateHandler", () => {
    void it("creates a banned user from a new Telegram user update", async (t) => {
        const { telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramUpdateHandler.handle(
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
        const { telegramApiService, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramUpdateHandler.handle(
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
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654323",
            isBanned: false,
            languageCode: "en",
        });

        await telegramUpdateHandler.handle(
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

    void it("handles a repeated update only once", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654328",
            isBanned: false,
            languageCode: "en",
        });

        const update = buildTelegramTextMessageUpdate({
            update_id: 42,
            message: {
                chat: buildTelegramPrivateChat({
                    id: 987654328,
                }),
                text: "ping",
            },
        });

        await telegramUpdateHandler.handle(update);
        await telegramUpdateHandler.handle(update);

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 1);
    });

    void it("doesn't send pong for an existing banned Telegram user", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654324",
            isBanned: true,
            languageCode: "en",
        });

        await telegramUpdateHandler.handle(
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

    void it("replies with a hint instead of pong on other text messages in a private chat", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654325",
            isBanned: false,
            languageCode: "en",
        });

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654325,
                    }),
                    text: "hello",
                },
            }),
        );

        assert.deepEqual(readSentTexts(telegramApiService), [
            telegramLocales.en.unknown,
        ]);
    });

    void it("doesn't send pong when ping is marked as a command for an existing unbanned user", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: "987654326",
            isBanned: false,
            languageCode: "en",
        });

        await telegramUpdateHandler.handle(
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

        assert.deepEqual(readSentTexts(telegramApiService), [
            telegramLocales.en.unknown,
        ]);
    });

    void it("skips updates without a Telegram user", async (t) => {
        const { telegramApiService, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramUpdateHandler.handle(buildTelegramPollUpdate());

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 0);
        assert.equal(await mongo.collection("users").countDocuments(), 0);
    });
    void it("replies with an error when the user can't be loaded", async (t) => {
        const bot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
        });

        t.mock.method(bot.usersRepository, "findOneByTelegramIdOrCreate", () =>
            Promise.reject(new Error("MongoDB is down")),
        );
        await bot.telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654396 }),
                    text: "hello",
                },
            }),
        );

        assert.deepEqual(bot.readSentTexts(), [telegramLocales.en.error]);
    });

    void it("replies with an error when the user can't be loaded and the callback answer fails", async (t) => {
        const bot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
        });

        t.mock.method(bot.usersRepository, "findOneByTelegramIdOrCreate", () =>
            Promise.reject(new Error("MongoDB is down")),
        );
        bot.telegramApiService.answerCallbackQuery.mock.mockImplementation(() =>
            Promise.reject(new Error("Request timed out")),
        );
        await bot.telegramUpdateHandler.handle(
            buildTelegramCallbackQueryUpdate({
                message: buildTelegramTextMessage({
                    chat: buildTelegramPrivateChat({ id: 987654398 }),
                }),
            }),
        );

        assert.deepEqual(
            bot.telegramApiService.answerCallbackQuery.mock.calls.map(
                (call) => call.arguments[0].callback_query_id,
            ),
            ["callback-query-1"],
        );
        assert.deepEqual(bot.readSentTexts(), [telegramLocales.en.error]);
    });

    void it("replies with an error once when a command fails and the session is lost", async (t) => {
        const logs = createLogCollector();
        const chat = buildTelegramPrivateChat({ id: 987654399 });
        const bot: TelegramSceneBot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            logger: { ...logs.logger, serializers: requestLogSerializers },
            registerRoutes: (router, sceneEngine) => {
                const pickScene = defineScene({
                    name: "pick",
                    state: Type.Object({}),
                    ttl: 60_000,
                });

                router.scene(pickScene);
                router.command("drop", async (ctx) => {
                    await sceneEngine.start(ctx, pickScene, {});
                    await ctx.reply("Pick");
                    await bot.cache.delete(`${buildSessionKey(chat.id)}:lock`);
                    throw new Error("Command failed");
                });
            },
        });

        await bot.sendText(chat, "/drop");

        const logOutput = JSON.stringify(logs.readEntries());

        assert.deepEqual(bot.readSentTexts(), [
            "Pick",
            telegramLocales.en.error,
        ]);
        assert.ok(logOutput.includes("Command failed"));
        assert.ok(logOutput.includes("was lost before the write"));
    });

    void it("ignores updates from groups and channels", async (t) => {
        const calls: string[] = [];
        const { telegramApiService, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.command("help", async () => {
                        calls.push("help");
                    });
                },
            });

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                update_id: 2,
                message: {
                    chat: buildTelegramSupergroupChat({ id: -1004 }),
                    from: buildTelegramUser({ id: 987654330 }),
                    entities: [{ length: 5, offset: 0, type: "bot_command" }],
                    text: "/help",
                },
            }),
        );
        await telegramUpdateHandler.handle(
            buildTelegramChannelPostUpdate({ text: "/help" }),
        );

        assert.deepEqual(calls, []);
        assert.deepEqual(readSentTexts(telegramApiService), []);
        assert.equal(await mongo.collection("users").countDocuments(), 0);
    });

    void it("stays silent on unhandled updates that are not new messages", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await createUser(usersRepository, "987654331");

        await telegramUpdateHandler.handle(
            buildTelegramEditedMessageUpdate({
                chat: buildTelegramPrivateChat({ id: 987654331 }),
                text: "hello",
            }),
        );

        assert.deepEqual(readSentTexts(telegramApiService), []);
    });

    void it("replies with an error in the user's language when a handler fails", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.on(text("boom"), async () => {
                        throw new Error("Handler failed");
                    });
                },
            });

        await createUser(usersRepository, "987654332", "uk");

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654332 }),
                    from: buildTelegramUser({
                        id: 987654332,
                        language_code: "uk",
                    }),
                    text: "boom",
                },
            }),
        );

        assert.deepEqual(readSentTexts(telegramApiService), [
            telegramLocales.uk.error,
        ]);
    });

    void it("stores the Telegram language of a new user", async (t) => {
        const { telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654333 }),
                    from: buildTelegramUser({
                        id: 987654333,
                        language_code: "uk-UA",
                    }),
                    text: "hello",
                },
            }),
        );

        const user = await usersRepository.findOneByTelegramId("987654333");

        assert.equal(user?.languageCode, "uk");
    });

    void it("uses English for a new user with an unsupported language", async (t) => {
        const { telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654334 }),
                    from: buildTelegramUser({
                        id: 987654334,
                        language_code: "de",
                    }),
                    text: "hello",
                },
            }),
        );

        const user = await usersRepository.findOneByTelegramId("987654334");

        assert.equal(user?.languageCode, "en");
    });

    void it("follows a language change in Telegram", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await createUser(usersRepository, "987654335", "en");

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654335 }),
                    from: buildTelegramUser({
                        id: 987654335,
                        language_code: "ru",
                    }),
                    text: "hello",
                },
            }),
        );

        const user = await usersRepository.findOneByTelegramId("987654335");

        assert.equal(user?.languageCode, "ru");
        assert.deepEqual(readSentTexts(telegramApiService), [
            telegramLocales.ru.unknown,
        ]);
    });

    void it("keeps the stored language when Telegram sends no language", async (t) => {
        const { telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await createUser(usersRepository, "987654336", "uk");

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654336 }),
                    from: buildTelegramUser({
                        id: 987654336,
                        language_code: undefined,
                    }),
                    text: "hello",
                },
            }),
        );

        const user = await usersRepository.findOneByTelegramId("987654336");

        assert.equal(user?.languageCode, "uk");
    });

    void it("greets a user with access on /start", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await createUser(usersRepository, "987654337");

        await telegramUpdateHandler.handle(
            buildStartUpdate(987654337, "/start"),
        );

        assert.deepEqual(readSentTexts(telegramApiService), [
            telegramLocales.en.welcome,
        ]);
    });
});

void describe("TelegramUpdateHandler invites", () => {
    void it("gives access to a banned user with a valid invite token", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                env: { INVITE_TOKEN: "invite-secret" },
            });

        await telegramUpdateHandler.handle(
            buildStartUpdate(987654338, "/start invite-secret"),
        );

        const user = await usersRepository.findOneByTelegramId("987654338");

        assert.equal(user?.isBanned, false);
        assert.deepEqual(readSentTexts(telegramApiService), [
            telegramLocales.en.welcome,
        ]);
    });

    void it("keeps a user banned with a wrong invite token", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                env: { INVITE_TOKEN: "invite-secret" },
            });

        await telegramUpdateHandler.handle(
            buildStartUpdate(987654339, "/start wrong-secret"),
        );

        const user = await usersRepository.findOneByTelegramId("987654339");

        assert.equal(user?.isBanned, true);
        assert.deepEqual(readSentTexts(telegramApiService), []);
    });

    void it("keeps a user banned when invites are not configured", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramUpdateHandler.handle(
            buildStartUpdate(987654340, "/start"),
        );

        const user = await usersRepository.findOneByTelegramId("987654340");

        assert.equal(user?.isBanned, true);
        assert.deepEqual(readSentTexts(telegramApiService), []);
    });
});

function readSentTexts(telegramApiService: TelegramApiServiceMock): string[] {
    return telegramApiService.sendMessage.mock.calls.map(
        (call) => call.arguments[0].text,
    );
}

async function createUser(
    usersRepository: UsersRepository,
    telegramId: string,
    languageCode: Language = "en",
): Promise<void> {
    await usersRepository.findOneByTelegramIdOrCreate({
        telegramId,
        isBanned: false,
        languageCode,
    });
}

function buildStartUpdate(telegramId: number, messageText: string) {
    return buildTelegramTextMessageUpdate({
        message: {
            chat: buildTelegramPrivateChat({ id: telegramId }),
            entities: [{ length: 6, offset: 0, type: "bot_command" }],
            text: messageText,
        },
    });
}
