import { Type } from "@sinclair/typebox";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { buildTestMongo } from "../../../test/mongo.js";
import { TelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import {
    buildTelegramPrivateChat,
    buildTelegramTextMessageUpdate,
    buildTelegramUser,
} from "../../../test/telegram-fixtures.js";
import { buildTelegramSceneBot } from "../../../test/telegram-scene-bot.js";
import { UsersRepository } from "../users/users-repository.js";
import { message, text } from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramRouter } from "./telegram-router.js";
import { defineScene, next as nextStep } from "./telegram-scene.js";

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

void describe("TelegramRouter", () => {
    void it("runs global middlewares in registration order around the route", async (t) => {
        const calls: string[] = [];
        const { telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.use(async (_ctx, next) => {
                        calls.push("first:before");
                        await next();
                        calls.push("first:after");
                    });
                    router.use(async (_ctx, next) => {
                        calls.push("second");
                        await next();
                    });
                    router.on(text("hello"), async () => {
                        calls.push("handler");
                    });
                },
            });

        await createUser(usersRepository, 987654341);
        await telegramUpdateHandler.handle(buildTextUpdate(987654341, "hello"));

        assert.deepEqual(calls, [
            "first:before",
            "second",
            "handler",
            "first:after",
        ]);
    });

    void it("stops the update when a middleware doesn't call next", async (t) => {
        const calls: string[] = [];
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.use(async () => {
                        calls.push("middleware");
                    });
                    router.on(text("hello"), async () => {
                        calls.push("handler");
                    });
                },
            });

        await createUser(usersRepository, 987654342);
        await telegramUpdateHandler.handle(buildTextUpdate(987654342, "hello"));

        assert.deepEqual(calls, ["middleware"]);
        assert.deepEqual(readSentTexts(telegramApiService), []);
    });

    void it("runs route middlewares only for their route", async (t) => {
        const calls: string[] = [];
        const { telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.on(
                        text("first"),
                        async () => {
                            calls.push("first");
                        },
                        {
                            use: [
                                async (_ctx, next) => {
                                    calls.push("first:middleware");
                                    await next();
                                },
                            ],
                        },
                    );
                    router.on(text("second"), async () => {
                        calls.push("second");
                    });
                },
            });

        await createUser(usersRepository, 987654343);
        await telegramUpdateHandler.handle(
            buildTextUpdate(987654343, "second", 1),
        );
        await telegramUpdateHandler.handle(
            buildTextUpdate(987654343, "first", 2),
        );

        assert.deepEqual(calls, ["second", "first:middleware", "first"]);
    });

    void it("fails the update when a middleware calls next twice", async (t) => {
        const { telegramApiService, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.use(async (_ctx, next) => {
                        await next();
                        await next();
                    });
                    router.on(text("hello"), async () => undefined);
                },
            });

        await createUser(usersRepository, 987654344);
        await telegramUpdateHandler.handle(buildTextUpdate(987654344, "hello"));

        assert.deepEqual(readSentTexts(telegramApiService), [
            telegramLocales.en.error,
        ]);
    });

    void it("handles a command with a bot username suffix", async (t) => {
        const calls: string[] = [];
        const { telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.command("test", async () => {
                        calls.push("test");
                    });
                },
            });

        await createUser(usersRepository, 987654345);
        await telegramUpdateHandler.handle(
            buildCommandUpdate(987654345, "/test@BipBopBot"),
        );

        assert.deepEqual(calls, ["test"]);
    });

    void it("rejects a command registered twice", async (t) => {
        await assert.rejects(
            () =>
                buildTelegramBotServiceTestApp({
                    databaseName,
                    mongoClient,
                    t,
                    registerRoutes: (router) => {
                        router.command("start", async () => undefined);
                    },
                }),
            { message: 'Telegram command "start" is already registered' },
        );
    });

    void it("routes by an async predicate that reads the context", async (t) => {
        const calls: string[] = [];
        const bot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            registerRoutes: (router) => {
                router.when(
                    async (ctx) => {
                        await setTimeout(1);
                        return ctx.user.telegramId === "987654347";
                    },
                    async (ctx) => {
                        calls.push(ctx.user.telegramId);
                    },
                );
            },
        });

        await bot.sendText(buildTelegramPrivateChat({ id: 987654347 }), "hi");
        await bot.sendText(buildTelegramPrivateChat({ id: 987654348 }), "hi");

        assert.deepEqual(calls, ["987654347"]);
        assert.deepEqual(bot.readSentTexts(), [telegramLocales.en.unknown]);
    });

    void it("doesn't ask a predicate while a scene step handles the update", async (t) => {
        let predicateCalls = 0;
        const echoScene = defineScene({
            name: "echo",
            state: Type.Object({}),
            ttl: 60_000,
            start: (ctx, scene) => scene.ask("text"),
            inputs: {
                text: {
                    payload: Type.Object({ text: Type.String() }),
                    steps: (step) => [
                        step("text", message("text"), {
                            enter: async (ctx) => {
                                await ctx.reply("Say something");
                            },
                            handle: async (ctx) =>
                                nextStep({ text: ctx.update.message.text }),
                        }),
                    ],
                    complete: (ctx, scene, payload) =>
                        ctx.reply(`Echo: ${payload.text}`),
                },
            },
        });
        const bot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            registerRoutes: (router, sceneEngine) => {
                router.scene(echoScene);
                router.command("echo", (ctx) =>
                    sceneEngine.start(ctx, echoScene, {}),
                );
                router.when(
                    () => {
                        predicateCalls += 1;
                        return true;
                    },
                    (ctx) => ctx.reply("Predicate route"),
                );
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654349 });

        await bot.sendText(chat, "/echo");
        await bot.sendText(chat, "hello");

        assert.equal(predicateCalls, 0);
        assert.deepEqual(bot.readSentTexts(), ["Say something", "Echo: hello"]);
    });

    void it("rejects routes registered after the app is ready", async (t) => {
        const { app } = await buildTelegramBotServiceTestApp({
            databaseName,
            mongoClient,
            t,
        });
        const router = app.getDecorator<TelegramRouter>("telegramRouter");

        assert.throws(
            () => {
                router.on(text("late"), async () => undefined);
            },
            {
                message:
                    "Telegram routes cannot be registered after the app is ready",
            },
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
    telegramId: number,
): Promise<void> {
    await usersRepository.findOneByTelegramIdOrCreate({
        telegramId: String(telegramId),
        isBanned: false,
        languageCode: "en",
    });
}

function buildTextUpdate(
    telegramId: number,
    messageText: string,
    updateId = 1,
) {
    return buildTelegramTextMessageUpdate({
        update_id: updateId,
        message: {
            chat: buildTelegramPrivateChat({ id: telegramId }),
            text: messageText,
        },
    });
}

function buildCommandUpdate(telegramId: number, messageText: string) {
    return buildTelegramTextMessageUpdate({
        message: {
            chat: buildTelegramPrivateChat({ id: telegramId }),
            from: buildTelegramUser({ id: telegramId }),
            entities: [
                { length: messageText.length, offset: 0, type: "bot_command" },
            ],
            text: messageText,
        },
    });
}
