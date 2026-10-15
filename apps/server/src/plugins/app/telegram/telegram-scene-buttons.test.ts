import { Type } from "@sinclair/typebox";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import {
    after,
    before,
    beforeEach,
    describe,
    it,
    TestContext,
} from "node:test";
import { buildTestMongo } from "../../../test/mongo.js";
import {
    buildTelegramCallbackQueryUpdate,
    buildTelegramPrivateChat,
    buildTelegramUser,
} from "../../../test/telegram-fixtures.js";
import {
    buildSessionKey,
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramRouter } from "./telegram-router.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
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

void describe("TelegramSceneButtons", () => {
    void it("passes the stored value to the scene button and answers the press", async (t) => {
        const bot = await buildGreetBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654381 });

        await bot.sendText(chat, "/greet Ada");
        await bot.pressButton(chat, "Greet Ada");

        assert.deepEqual(bot.readSentTexts(), ["Press the button", "Hi Ada"]);
        assert.deepEqual(readAnswerTexts(bot), [undefined]);
    });

    void it("keeps the buttons of every message of a scene", async (t) => {
        const bot = await buildGreetBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654382 });

        for (const name of ["A", "B", "C", "D", "E", "F", "G"]) {
            await bot.sendText(chat, `/greet ${name}`);
        }

        await bot.pressButton(chat, "Greet A");

        assert.deepEqual(bot.readSentTexts().slice(-1), ["Hi A"]);
        assert.deepEqual(readAnswerTexts(bot), [undefined]);
    });

    void it("reports an error once when the session is lost after a press", async (t) => {
        const chat = buildTelegramPrivateChat({ id: 987654397 });
        const bot: TelegramSceneBot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            registerRoutes: (router, sceneEngine) => {
                registerDropScene(router, sceneEngine, async () => {
                    await bot.cache.delete(`${buildSessionKey(chat.id)}:lock`);
                });
            },
        });

        const answeredIds = new Set<string>();

        bot.telegramApiService.answerCallbackQuery.mock.mockImplementation(
            async ({ callback_query_id: callbackQueryId }) => {
                if (answeredIds.has(callbackQueryId)) {
                    return {
                        ok: false,
                        error_code: 400,
                        description: "Bad Request: query is too old",
                    };
                }

                answeredIds.add(callbackQueryId);
                return { ok: true, result: true };
            },
        );

        await bot.sendText(chat, "/drop");
        await bot.pressButton(chat, "Drop");

        assert.deepEqual(bot.readSentTexts(), [
            "Press the button",
            telegramLocales.en.error,
        ]);
    });

    void it("reports an error once when a scene button fails and the session is lost", async (t) => {
        const chat = buildTelegramPrivateChat({ id: 987654400 });
        const bot: TelegramSceneBot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            registerRoutes: (router, sceneEngine) => {
                registerDropScene(router, sceneEngine, async () => {
                    await bot.cache.delete(`${buildSessionKey(chat.id)}:lock`);
                    throw new Error("Button failed");
                });
            },
        });

        await bot.sendText(chat, "/drop");
        await bot.pressButton(chat, "Drop");

        assert.deepEqual(bot.readSentTexts(), [
            "Press the button",
            telegramLocales.en.error,
        ]);
        assert.equal(
            bot.telegramApiService.answerCallbackQuery.mock.callCount(),
            1,
        );
    });

    void it("answers the press and reports the error when a scene button fails", async (t) => {
        const bot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            registerRoutes: (router, sceneEngine) => {
                registerDropScene(router, sceneEngine, async () => {
                    throw new Error("Button failed");
                });
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654387 });

        await bot.sendText(chat, "/drop");
        await bot.pressButton(chat, "Drop");

        assert.deepEqual(bot.readSentTexts(), [
            "Press the button",
            telegramLocales.en.error,
        ]);
        assert.deepEqual(readAnswerTexts(bot), [undefined]);
    });

    void it("answers a press that nothing handles", async (t) => {
        const bot = await buildGreetBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654386 });

        await bot.sendCallback(chat, "legacy-data", 3);

        assert.deepEqual(bot.readSentTexts(), []);
        assert.deepEqual(readAnswerTexts(bot), [undefined]);
    });

    void it("rejects a scene registered twice", async (t) => {
        await assert.rejects(
            () =>
                buildTelegramSceneBot({
                    databaseName,
                    mongoClient,
                    t,
                    registerRoutes: (router, sceneEngine) => {
                        registerGreetScene(router, sceneEngine);
                        router.scene(
                            defineScene({
                                name: "greet",
                                state: Type.Object({}),
                                ttl: 60_000,
                            }),
                        );
                    },
                }),
            { message: 'Telegram scene "greet" is already registered' },
        );
    });

    void it("answers a press from a user without access", async (t) => {
        const bot = await buildGreetBot(t);

        await bot.telegramUpdateHandler.handle(
            buildTelegramCallbackQueryUpdate({
                from: buildTelegramUser({ id: 987654388 }),
                data: "stored:1",
            }),
        );

        assert.deepEqual(bot.readSentTexts(), []);
        assert.deepEqual(readAnswerTexts(bot), [undefined]);
    });
});

async function buildGreetBot(t: TestContext): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: registerGreetScene,
    });
}

function registerGreetScene(
    router: TelegramRouter,
    sceneEngine: TelegramSceneEngine,
): void {
    const greetScene = defineScene({
        name: "greet",
        state: Type.Object({ name: Type.String() }),
        ttl: 60_000,
        start: (ctx, scene) =>
            ctx.reply("Press the button", {
                reply_markup: {
                    inline_keyboard: [
                        [
                            scene.button(`Greet ${scene.state.name}`, "greet", {
                                name: scene.state.name,
                            }),
                        ],
                    ],
                },
            }),
        buttons: {
            greet: {
                value: Type.Object({ name: Type.String() }),
                handle: (ctx, scene, value) => ctx.reply(`Hi ${value.name}`),
            },
        },
    });

    router.scene(greetScene);
    router.command("greet", (ctx) =>
        sceneEngine.start(ctx, greetScene, {
            name: ctx.update.message.text.split(" ")[1] ?? "",
        }),
    );
}

function registerDropScene(
    router: TelegramRouter,
    sceneEngine: TelegramSceneEngine,
    onPress: () => Promise<void>,
): void {
    const dropScene = defineScene({
        name: "drop",
        state: Type.Object({}),
        ttl: 60_000,
        start: (ctx, scene) =>
            ctx.reply("Press the button", {
                reply_markup: {
                    inline_keyboard: [[scene.button("Drop", "drop", null)]],
                },
            }),
        buttons: {
            drop: {
                value: Type.Null(),
                handle: onPress,
            },
        },
    });

    router.scene(dropScene);
    router.command("drop", (ctx) => sceneEngine.start(ctx, dropScene, {}));
}

function readAnswerTexts(bot: TelegramSceneBot): (string | undefined)[] {
    return bot.telegramApiService.answerCallbackQuery.mock.calls.map(
        (call) => call.arguments[0].text,
    );
}
