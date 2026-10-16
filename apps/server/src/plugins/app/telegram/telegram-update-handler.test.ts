import { Type } from "@sinclair/typebox";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { requestLogSerializers } from "../../../request-logging.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "../../../test/telegram-api-service-mock.js";
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
import { telegramApiScope } from "./telegram-api-service.js";
import { text } from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramRouter } from "./telegram-router.js";
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
                registerRoutes: registerPing,
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
                registerRoutes: registerPing,
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

    void it("skips the error reply when the user blocked the bot", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({
            t,
            sendMessageResponse: {
                ok: false,
                error_code: 403,
                description: "Forbidden: bot was blocked by the user",
            },
        });
        const { metrics, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                telegramApiService,
                registerRoutes: registerPing,
            });

        await createUser(usersRepository, "987654324");
        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654324 }),
                    text: "ping",
                },
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 1);
        assert.match(
            await metrics.metrics(),
            /^telegram_updates_total\{type="message",result="blocked"\} 1$/m,
        );
    });

    void it("stops an update that holds the session lock too long", async (t) => {
        const {
            metrics,
            telegramApiService,
            telegramUpdateHandler,
            usersRepository,
        } = await buildTelegramBotServiceTestApp({
            databaseName,
            mongoClient,
            t,
            sessionStoreOptions: { lockMaxHoldMilliseconds: 100 },
            registerRoutes: (router) => {
                router.on(text("slow"), () => waitForScopeAbort());
            },
        });

        await createUser(usersRepository, "987654325");
        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654325 }),
                    text: "slow",
                },
            }),
        );

        assert.deepEqual(
            telegramApiService.sendMessage.mock.calls.map(
                (call) => call.arguments[0].text,
            ),
            [telegramLocales.en.error],
        );
        assert.match(
            await metrics.metrics(),
            /^telegram_updates_total\{type="message",result="lock_hold_timeout"\} 1$/m,
        );
    });

    void it("handles a repeated update only once", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: registerPing,
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
                registerRoutes: registerPing,
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
                registerRoutes: registerPing,
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
                registerRoutes: registerPing,
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

    void it("stores and follows the Telegram name and username", async (t) => {
        const { telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
            });

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                update_id: 1,
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654342 }),
                    from: buildTelegramUser({
                        id: 987654342,
                        first_name: "Ada",
                        username: "ada",
                    }),
                    text: "hello",
                },
            }),
        );

        const created = await usersRepository.findOneByTelegramId("987654342");

        await telegramUpdateHandler.handle(
            buildTelegramTextMessageUpdate({
                update_id: 2,
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654342 }),
                    from: buildTelegramUser({
                        id: 987654342,
                        first_name: "Grace",
                        username: undefined,
                    }),
                    text: "hello",
                },
            }),
        );

        const updated = await usersRepository.findOneByTelegramId("987654342");

        assert.equal(created?.firstName, "Ada");
        assert.equal(created.username, "ada");
        assert.equal(updated?.firstName, "Grace");
        assert.ok(updated);
        assert.equal("username" in updated, false);
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

void describe("TelegramUpdateHandler deep links", () => {
    void it("routes /start with a named payload of a banned user to a deep link that allows banned users", async (t) => {
        const values: string[] = [];
        const { telegramApiService, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.deepLink(
                        "invite",
                        async (ctx, value) => {
                            values.push(value);
                            await ctx.reply("welcome");
                        },
                        { allowBanned: true },
                    );
                },
            });

        await telegramUpdateHandler.handle(
            buildStartUpdate(987654338, "/start invite_secret_A-1"),
        );

        assert.deepEqual(values, ["secret_A-1"]);
        assert.deepEqual(readSentTexts(telegramApiService), ["welcome"]);
    });

    void it("keeps a banned user silent for a deep link without allowBanned or with an unknown name", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.deepLink("poker", async (ctx) => {
                        await ctx.reply("poker");
                    });
                    router.deepLink(
                        "invite",
                        async (ctx) => {
                            await ctx.reply("welcome");
                        },
                        { allowBanned: true },
                    );
                },
            });

        await telegramUpdateHandler.handle(
            buildStartUpdate(987654339, "/start poker_42", 1),
        );
        await telegramUpdateHandler.handle(
            buildStartUpdate(987654339, "/start unknown_42", 2),
        );
        await telegramUpdateHandler.handle(
            buildStartUpdate(987654339, "/start invite", 3),
        );

        const user = await usersRepository.findOneByTelegramId("987654339");

        assert.equal(user?.isBanned, true);
        assert.deepEqual(readSentTexts(telegramApiService), []);
    });

    void it("keeps a banned user silent on /start without a payload", async (t) => {
        const { telegramApiService, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.deepLink(
                        "invite",
                        async (ctx) => {
                            await ctx.reply("welcome");
                        },
                        { allowBanned: true },
                    );
                },
            });

        await telegramUpdateHandler.handle(
            buildStartUpdate(987654340, "/start"),
        );

        assert.deepEqual(readSentTexts(telegramApiService), []);
    });

    void it("routes each name to its own deep link and greets on an unknown name", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.deepLink("invite", async (ctx, value) => {
                        await ctx.reply(`invite ${value}`);
                    });
                    router.deepLink("poker", async (ctx, value) => {
                        await ctx.reply(`poker ${value}`);
                    });
                },
            });

        await createUser(usersRepository, "987654341");

        await telegramUpdateHandler.handle(
            buildStartUpdate(987654341, "/start invite_abc", 1),
        );
        await telegramUpdateHandler.handle(
            buildStartUpdate(987654341, "/start poker_42", 2),
        );
        await telegramUpdateHandler.handle(
            buildStartUpdate(987654341, "/start other_1", 3),
        );

        assert.deepEqual(readSentTexts(telegramApiService), [
            "invite abc",
            "poker 42",
            telegramLocales.en.welcome,
        ]);
    });

    void it("refuses a deep link name twice or with characters outside a-z and 0-9", async (t) => {
        await assert.rejects(
            buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.deepLink("invite", async () => undefined);
                    router.deepLink("invite", async () => undefined);
                },
            }),
            /Telegram deep link "invite" is already registered/,
        );
        await assert.rejects(
            buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.deepLink("join_poker", async () => undefined);
                },
            }),
            /Telegram deep link name "join_poker" must match/,
        );
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

async function waitForScopeAbort(): Promise<void> {
    const signal = telegramApiScope.getStore()?.signal;

    assert.ok(signal);

    await new Promise((resolve) => {
        signal.addEventListener("abort", resolve);
    });
    signal.throwIfAborted();
}

function registerPing(router: TelegramRouter): void {
    router.on(text("ping"), async (ctx) => {
        await ctx.reply("pong");
    });
}

function buildStartUpdate(
    telegramId: number,
    messageText: string,
    updateId?: number,
) {
    return buildTelegramTextMessageUpdate({
        update_id: updateId,
        message: {
            chat: buildTelegramPrivateChat({ id: telegramId }),
            entities: [{ length: 6, offset: 0, type: "bot_command" }],
            text: messageText,
        },
    });
}
