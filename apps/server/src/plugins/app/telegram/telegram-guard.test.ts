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
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import { text } from "./telegram-filters.js";
import { TelegramGuard } from "./telegram-guard.js";
import { telegramLocales } from "./telegram-locales.js";
import { defineScene, TelegramScene } from "./telegram-scene.js";
import { textStep } from "./telegram-steps.js";

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

const isVip: TelegramGuard = (user) => user.grants.includes("vip");
const counterStateSchema = Type.Object({ count: Type.Number() });

interface GuardBot extends TelegramSceneBot {
    vipScene: TelegramScene<typeof counterStateSchema>;
    notes: string[];
}

void describe("Telegram guards on routes", () => {
    void it("answers a guarded command only to users the guard allows", async (t) => {
        const bot = await buildGuardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654501 });

        await bot.sendText(chat, "/secret");
        await setGrants(chat.id, ["vip"]);
        await bot.sendText(chat, "/secret");

        assert.deepEqual(bot.readSentTexts(), [
            telegramLocales.en.unknown,
            "secret",
        ]);
    });

    void it("skips a guarded match route for users the guard refuses", async (t) => {
        const bot = await buildGuardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654502 });

        await bot.sendText(chat, "hi");
        await setGrants(chat.id, ["vip"]);
        await bot.sendText(chat, "hi");

        assert.deepEqual(bot.readSentTexts(), [
            telegramLocales.en.unknown,
            "hi vip",
        ]);
    });
});

void describe("Telegram guards on scenes", () => {
    void it("refuses to start a guarded scene", async (t) => {
        const bot = await buildGuardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654503 });

        await bot.sendText(chat, "/vip");
        await setGrants(chat.id, ["vip"]);
        await bot.sendText(chat, "/vip");

        assert.deepEqual(bot.readSentTexts(), ["not started", "VIP 0"]);
    });

    void it("answers a guarded button with the forbidden text and skips its handler", async (t) => {
        const bot = await buildGuardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654504 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "+10");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(readCallbackAnswers(bot), [
            telegramLocales.en.forbidden,
            undefined,
        ]);
        assert.deepEqual(readEditedTexts(bot), ["Card 1"]);
    });

    void it("refuses the buttons of a running scene after the user loses the grant", async (t) => {
        const bot = await buildGuardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654505 });

        await bot.allowUser(chat.id);
        await setGrants(chat.id, ["vip"]);
        await bot.sendText(chat, "/vip");
        await setGrants(chat.id, []);
        await bot.pressButton(chat, "+1");

        assert.deepEqual(readCallbackAnswers(bot), [
            telegramLocales.en.forbidden,
        ]);
        assert.deepEqual(readEditedTexts(bot), []);
    });

    void it("refuses to ask a guarded input in the answer to the press", async (t) => {
        const bot = await buildGuardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654506 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Note");

        assert.deepEqual(bot.readSentTexts(), ["Card 0"]);
        assert.deepEqual(readCallbackAnswers(bot), [
            telegramLocales.en.forbidden,
        ]);
    });

    void it("passes the text for a guarded input to the routes after the user loses the grant", async (t) => {
        const bot = await buildGuardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654507 });

        await bot.allowUser(chat.id);
        await setGrants(chat.id, ["vip"]);
        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Note");
        await setGrants(chat.id, []);
        await bot.sendText(chat, "remember this");

        assert.deepEqual(bot.notes, []);
        assert.deepEqual(bot.readSentTexts(), [
            "Card 0",
            "Your note? Send /cancel to stop.",
            telegramLocales.en.unknown,
        ]);
    });

    void it("skips the delivery to a guarded scene after the user loses the grant", async (t) => {
        const bot = await buildGuardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654508 });
        const delivered: number[] = [];

        await bot.allowUser(chat.id);
        await setGrants(chat.id, ["vip"]);
        await bot.sendText(chat, "/vip");
        bot.telegramChats.deliver(
            bot.vipScene,
            [{ userId: chat.id, key: "vip" }],
            async (ctx, scene) => {
                delivered.push(scene.state.count);
                scene.state.count += 1;
            },
        );
        await bot.telegramChats.idle();
        await setGrants(chat.id, []);
        bot.telegramChats.deliver(
            bot.vipScene,
            [{ userId: chat.id, key: "vip" }],
            async (ctx, scene) => {
                delivered.push(scene.state.count);
            },
        );
        await bot.telegramChats.idle();

        assert.deepEqual(delivered, [0]);
        assert.deepEqual(readEditedTexts(bot), ["VIP 1"]);
    });
});

async function buildGuardBot(t: TestContext): Promise<GuardBot> {
    const notes: string[] = [];
    let vipScene!: TelegramScene<typeof counterStateSchema>;

    const bot = await buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router, sceneEngine) => {
            const cardScene = defineScene({
                name: "guard.card",
                state: counterStateSchema,
                ttl: 60_000,
                key: () => "card",
                slots: {
                    card: async (ctx, scene) => ({
                        kind: "text",
                        text: `Card ${scene.state.count}`,
                        keyboard: [
                            [
                                scene.button("+1", "add", null),
                                scene.button("+10", "bonus", null),
                                scene.button("Note", "note", null),
                            ],
                        ],
                    }),
                },
                buttons: {
                    add: {
                        value: Type.Null(),
                        handle: async (ctx, scene) => {
                            scene.state.count += 1;
                        },
                    },
                    bonus: {
                        value: Type.Null(),
                        guard: isVip,
                        handle: async (ctx, scene) => {
                            scene.state.count += 10;
                        },
                    },
                    note: {
                        value: Type.Null(),
                        handle: (ctx, scene) => scene.ask("note"),
                    },
                },
                inputs: {
                    note: {
                        payload: Type.Object({ note: Type.String() }),
                        guard: isVip,
                        steps: (step) => [
                            textStep(step, {
                                name: "note",
                                property: "note",
                                prompt: () =>
                                    "Your note? Send /cancel to stop.",
                            }),
                        ],
                        complete: async (ctx, scene, { note }) => {
                            notes.push(note);
                        },
                    },
                },
            });
            vipScene = defineScene({
                name: "guard.vip",
                state: counterStateSchema,
                ttl: 60_000,
                guard: isVip,
                key: () => "vip",
                slots: {
                    card: async (ctx, scene) => ({
                        kind: "text",
                        text: `VIP ${scene.state.count}`,
                        keyboard: [[scene.button("+1", "add", null)]],
                    }),
                },
                buttons: {
                    add: {
                        value: Type.Null(),
                        handle: async (ctx, scene) => {
                            scene.state.count += 1;
                        },
                    },
                },
            });

            router.scene(cardScene);
            router.scene(vipScene);
            router.command("card", async (ctx) => {
                await sceneEngine.start(ctx, cardScene, { count: 0 });
            });
            router.command("vip", async (ctx) => {
                if (!(await sceneEngine.start(ctx, vipScene, { count: 0 }))) {
                    await ctx.reply("not started");
                }
            });
            router.command(
                "secret",
                async (ctx) => {
                    await ctx.reply("secret");
                },
                { guard: isVip },
            );
            router.on(
                text("hi"),
                async (ctx) => {
                    await ctx.reply("hi vip");
                },
                { guard: isVip },
            );
        },
    });

    return { ...bot, vipScene, notes };
}

async function setGrants(telegramId: number, grants: string[]): Promise<void> {
    await mongo
        .collection("users")
        .updateOne({ telegramId: String(telegramId) }, { $set: { grants } });
}

function readCallbackAnswers(bot: TelegramSceneBot): (string | undefined)[] {
    return bot.telegramApiService.answerCallbackQuery.mock.calls.map(
        (call) => call.arguments[0].text,
    );
}

function readEditedTexts(bot: TelegramSceneBot): (string | undefined)[] {
    return bot.telegramApiService.editMessageText.mock.calls.map(
        (call) => call.arguments[0].text,
    );
}
