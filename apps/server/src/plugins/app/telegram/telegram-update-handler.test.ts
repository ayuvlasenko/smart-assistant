import { Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loggerRequestSerializers } from "../../../logger-request.js";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramBotServiceTestApp,
    buildTwoBotsTestApp,
} from "../../../test/telegram-bot-service-helper.js";
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
    testBotId,
    testTelegramBotId,
} from "../../../test/telegram-fixtures.js";
import {
    buildSessionKey,
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { adminGrant } from "../access/access-service.js";
import { autoBanSetting } from "../users/users-service.js";
import { telegramApiScope } from "./telegram-api-service.js";
import { text } from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramRouter } from "./telegram-router.js";
import { defineScene } from "./telegram-scene.js";

const testMongo = useTestMongo();

void describe("TelegramUpdateHandler", () => {
    void it("hands the logger of the update to every Bot API call of it, also outside the session lock", async (t) => {
        const logs = createLoggerCollector();
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            logger: { ...logs.logger, serializers: loggerRequestSerializers },
            registerRoutes: (router) => {
                router.command("hi", async (ctx) => {
                    await ctx.reply("hi");
                });
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654475 });
        const probe = (method: string) => () => {
            telegramApiScope.getStore()?.log?.info({ method }, "Scope probe");
        };

        bot.telegramApiService.setMyCommands.mock.mockImplementation(
            async () => {
                probe("setMyCommands")();
                return { ok: true, result: true };
            },
        );
        bot.telegramApiService.answerCallbackQuery.mock.mockImplementation(
            async () => {
                probe("answerCallbackQuery")();
                return { ok: true, result: true };
            },
        );
        await bot.allowUser(chat.id);
        await bot.sendText(chat, "/hi");
        await bot.sendCallback(chat, "unknown");

        const probes = logs
            .readEntries()
            .filter(({ msg }) => msg === "Scope probe");

        assert.deepEqual(
            probes.map(({ method, updateId, userId }) => ({
                method,
                hasUpdate: updateId !== undefined,
                hasUser: userId !== undefined,
            })),
            [
                { method: "setMyCommands", hasUpdate: true, hasUser: true },
                {
                    method: "answerCallbackQuery",
                    hasUpdate: true,
                    hasUser: true,
                },
            ],
        );
    });

    void it("creates a banned user from a new Telegram user update", async (t) => {
        const { telegramBots, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({
                        id: 987654321,
                    }),
                    text: "hello",
                },
            }),
        );

        const user = await usersRepository.findOneByTelegramId(
            testBotId,
            "987654321",
        );

        assert.ok(user);
        assert.equal(user.telegramId, "987654321");
        assert.equal(user.isBanned, true);
    });

    void it("logs the user of an update with the update id", async (t) => {
        const logs = createLoggerCollector();
        const { telegramBots, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                logger: logs.logger,
            });

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
            buildTelegramTextMessageUpdate({
                update_id: 4242,
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654323 }),
                    text: "hello",
                },
            }),
        );

        const entry = logs
            .readEntries()
            .find(({ msg }) => msg === "Update handled");

        assert.equal(entry?.updateId, 4242);
        assert.ok(entry.userId);
        assert.equal(entry.result, "banned");
    });

    void it("logs the command that handled an update and the command whose guard refused one", async (t) => {
        const logs = createLoggerCollector();
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            logger: logs.logger,
            registerRoutes: (router) => {
                router.command("secret", async () => undefined, {
                    guard: (user) => user.grants.includes("vip"),
                });
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654343 });

        await bot.sendText(chat, "/start");
        await bot.sendText(chat, "/secret");

        assert.deepEqual(
            logs
                .readEntries()
                .filter(({ msg }) => msg === "Update handled")
                .map(({ result, route, refusedRoute }) => ({
                    result,
                    route,
                    refusedRoute,
                })),
            [
                {
                    result: "handled",
                    route: "command:start",
                    refusedRoute: undefined,
                },
                {
                    result: "unhandled",
                    route: undefined,
                    refusedRoute: "command:secret",
                },
            ],
        );
    });

    void it("counts a user once, on the first update", async (t) => {
        const { metrics, telegramBots, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });
        const chat = buildTelegramPrivateChat({ id: 987654324 });

        for (const updateId of [1, 2]) {
            await telegramUpdateHandler.handle(
                await telegramBots.root(),
                buildTelegramTextMessageUpdate({
                    update_id: updateId,
                    message: { chat, text: "hello" },
                }),
            );
        }

        assert.match(
            await metrics.metrics(),
            /^telegram_users_created_total 1$/m,
        );
    });

    void it("creates a user without a ban when the auto ban is off", async (t) => {
        const {
            settingsService,
            telegramBots,
            telegramUpdateHandler,
            usersRepository,
        } = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
        });

        await settingsService.write(
            buildUserEntity({ grants: [adminGrant] }),
            autoBanSetting,
            false,
        );
        await telegramUpdateHandler.handle(
            await telegramBots.root(),
            buildTelegramTextMessageUpdate({
                message: {
                    chat: buildTelegramPrivateChat({ id: 987654325 }),
                    text: "hello",
                },
            }),
        );

        const user = await usersRepository.findOneByTelegramId(
            testBotId,
            "987654325",
        );

        assert.equal(user?.isBanned, false);
    });

    void it("doesn't send pong for a newly created banned user", async (t) => {
        const { telegramApiService, telegramBots, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                registerRoutes: registerPing,
            });

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
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
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: registerPing,
        });

        await bot.sendText(buildTelegramPrivateChat({ id: 987654323 }), "ping");

        assert.equal(bot.telegramApiService.sendMessage.mock.callCount(), 1);
        assert.deepEqual(
            bot.telegramApiService.sendMessage.mock.calls[0]?.arguments,
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
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            telegramApiService,
            registerRoutes: registerPing,
        });

        await bot.sendText(buildTelegramPrivateChat({ id: 987654324 }), "ping");

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 1);
        assert.match(
            await bot.metrics.metrics(),
            new RegExp(
                `^telegram_updates_total\\{type="message",result="blocked",bot="${testTelegramBotId}"\\} 1$`,
                "m",
            ),
        );
    });

    void it("stops an update that holds the session lock too long", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            sessionStoreOptions: { lockMaxHoldMilliseconds: 100 },
            registerRoutes: (router) => {
                router.on(text("slow"), () => waitForScopeAbort());
            },
        });

        await bot.sendText(buildTelegramPrivateChat({ id: 987654325 }), "slow");

        assert.deepEqual(bot.readSentTexts(), [telegramLocales.en.error]);
        assert.match(
            await bot.metrics.metrics(),
            new RegExp(
                `^telegram_updates_total\\{type="message",result="lock_hold_timeout",bot="${testTelegramBotId}"\\} 1$`,
                "m",
            ),
        );
    });

    void it("handles a repeated update only once", async (t) => {
        const {
            telegramApiService,
            telegramBots,
            telegramUpdateHandler,
            usersRepository,
        } = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            registerRoutes: registerPing,
        });

        await usersRepository.findOneByTelegramIdOrCreate({
            botId: testBotId,
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

        await telegramUpdateHandler.handle(await telegramBots.root(), update);
        await telegramUpdateHandler.handle(await telegramBots.root(), update);

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 1);
    });

    void it("handles the same update id of two bots in each bot", async (t) => {
        const {
            child,
            childBotId,
            telegramApiService,
            telegramBots,
            telegramUpdateHandler,
        } = await buildTwoBotsTestApp({
            testMongo,
            t,
            autoBan: false,
            registerRoutes: registerPing,
        });
        const update = buildTelegramTextMessageUpdate({
            update_id: 42,
            message: {
                chat: buildTelegramPrivateChat({ id: 987654344 }),
                text: "ping",
            },
        });

        await telegramUpdateHandler.handle(await telegramBots.root(), update);
        await telegramUpdateHandler.handle(
            await telegramBots.get(childBotId),
            update,
        );

        assert.deepEqual(
            telegramApiService.sendMessage.mock.calls.map(
                (call) => call.arguments,
            ),
            [[{ chat_id: 987654344, text: "pong" }]],
        );
        assert.deepEqual(
            child.sendMessage.mock.calls.map((call) => call.arguments),
            [[{ chat_id: 987654344, text: "pong" }]],
        );
    });

    void it("doesn't send pong for an existing banned Telegram user", async (t) => {
        const {
            telegramApiService,
            telegramBots,
            telegramUpdateHandler,
            usersRepository,
        } = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            registerRoutes: registerPing,
        });

        await usersRepository.findOneByTelegramIdOrCreate({
            botId: testBotId,
            telegramId: "987654324",
            isBanned: true,
            languageCode: "en",
        });

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
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

    void it("stays silent instead of pong on other text messages in a private chat", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: registerPing,
        });

        await bot.sendText(
            buildTelegramPrivateChat({ id: 987654325 }),
            "hello",
        );

        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("doesn't send pong when ping is marked as a command for an existing unbanned user", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: registerPing,
        });

        await bot.allowUser(987654326);
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
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

        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("skips updates without a Telegram user", async (t) => {
        const { telegramApiService, telegramBots, telegramUpdateHandler } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
            buildTelegramPollUpdate(),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 0);
        assert.equal(
            await testMongo.mongo.collection("users").countDocuments(),
            0,
        );
    });
    void it("replies with an error when the user can't be loaded", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
        });

        t.mock.method(bot.usersRepository, "findOneByTelegramIdOrCreate", () =>
            Promise.reject(new Error("MongoDB is down")),
        );
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
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
            testMongo,
            t,
        });

        t.mock.method(bot.usersRepository, "findOneByTelegramIdOrCreate", () =>
            Promise.reject(new Error("MongoDB is down")),
        );
        bot.telegramApiService.answerCallbackQuery.mock.mockImplementation(() =>
            Promise.reject(new Error("Request timed out")),
        );
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
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
        const logs = createLoggerCollector();
        const chat = buildTelegramPrivateChat({ id: 987654399 });
        const bot: TelegramSceneBot = await buildTelegramSceneBot({
            testMongo,
            t,
            logger: { ...logs.logger, serializers: loggerRequestSerializers },
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
        const logs = createLoggerCollector();
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            logger: logs.logger,
            registerRoutes: (router) => {
                router.command("help", async () => {
                    calls.push("help");
                });
            },
        });

        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
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
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
            buildTelegramChannelPostUpdate({ text: "/help" }),
        );

        assert.deepEqual(
            logs
                .readEntries()
                .filter(({ msg }) => msg === "Update handled")
                .map(({ result }) => result),
            ["ignored", "ignored"],
        );
        assert.deepEqual(calls, []);
        assert.deepEqual(bot.readSentTexts(), []);
        assert.equal(
            await testMongo.mongo.collection("users").countDocuments(),
            0,
        );
    });

    void it("stays silent on unhandled updates that are not new messages", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
        });

        await bot.allowUser(987654331);
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
            buildTelegramEditedMessageUpdate({
                chat: buildTelegramPrivateChat({ id: 987654331 }),
                text: "hello",
            }),
        );

        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("replies with an error in the user's language when a handler fails", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: (router) => {
                router.on(text("boom"), async () => {
                    throw new Error("Handler failed");
                });
            },
        });

        await bot.usersRepository.findOneByTelegramIdOrCreate({
            botId: testBotId,
            telegramId: "987654332",
            isBanned: false,
            languageCode: "uk",
        });
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
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

        assert.deepEqual(bot.readSentTexts(), [telegramLocales.uk.error]);
    });

    void it("stores the Telegram language of a new user", async (t) => {
        const { telegramBots, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
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

        const user = await usersRepository.findOneByTelegramId(
            testBotId,
            "987654333",
        );

        assert.equal(user?.languageCode, "uk");
    });

    void it("uses English for a new user with an unsupported language", async (t) => {
        const { telegramBots, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
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

        const user = await usersRepository.findOneByTelegramId(
            testBotId,
            "987654334",
        );

        assert.equal(user?.languageCode, "en");
    });

    void it("follows a language change in Telegram", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
        });

        await bot.allowUser(987654335);
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
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

        const user = await bot.usersRepository.findOneByTelegramId(
            testBotId,
            "987654335",
        );

        assert.equal(user?.languageCode, "ru");
        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("keeps the stored language when Telegram sends no language", async (t) => {
        const { telegramBots, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });

        await usersRepository.findOneByTelegramIdOrCreate({
            botId: testBotId,
            telegramId: "987654336",
            isBanned: false,
            languageCode: "uk",
        });
        await telegramUpdateHandler.handle(
            await telegramBots.root(),
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

        const user = await usersRepository.findOneByTelegramId(
            testBotId,
            "987654336",
        );

        assert.equal(user?.languageCode, "uk");
    });

    void it("stores and follows the Telegram name and username", async (t) => {
        const { telegramBots, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
            });

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
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

        const created = await usersRepository.findOneByTelegramId(
            testBotId,
            "987654342",
        );

        await telegramUpdateHandler.handle(
            await telegramBots.root(),
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

        const updated = await usersRepository.findOneByTelegramId(
            testBotId,
            "987654342",
        );

        assert.equal(created?.firstName, "Ada");
        assert.equal(created.username, "ada");
        assert.equal(updated?.firstName, "Grace");
        assert.ok(updated);
        assert.equal("username" in updated, false);
    });

    void it("greets a user with access on /start", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
        });

        await bot.sendText(
            buildTelegramPrivateChat({ id: 987654337 }),
            "/start",
        );

        assert.deepEqual(bot.readSentTexts(), [telegramLocales.en.welcome]);
    });
});

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
