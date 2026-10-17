import { Update } from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
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
import { message, TelegramTextMessageUpdate } from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import { formatDate } from "./telegram-parsers.js";
import { TelegramRouter } from "./telegram-router.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import { defineScene } from "./telegram-scene.js";
import {
    choiceStep,
    dateStep,
    numberStep,
    textStep,
} from "./telegram-steps.js";

const orderSchema = Type.Object({
    title: Type.String(),
    note: Type.Optional(Type.String()),
    amount: Type.Number(),
    date: Type.String(),
    color: Type.String(),
});

type Order = Static<typeof orderSchema>;

const colors = [
    { label: "Red", value: "red" },
    { label: "Green", value: "green" },
    { label: "Blue", value: "blue" },
];

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

void describe("Telegram steps", () => {
    void it("collects text, number, date and choice values", async (t) => {
        const completed: Order[] = [];
        const bot = await buildOrderBot(t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654371 });

        await bot.sendText(chat, "/order");
        await bot.sendText(chat, "Tea");
        await bot.sendText(chat, "/skip");
        await bot.sendText(chat, "1 000,5");
        await bot.sendText(chat, "12,5");
        await bot.sendText(chat, "05.03.2026");

        assert.deepEqual(readLabels(bot.readLastKeyboard()), [
            ["Red"],
            ["Green"],
            ["›"],
        ]);

        await bot.pressButton(chat, "›");

        assert.deepEqual(readLabels(bot.readLastEditedKeyboard()), [
            ["Blue"],
            ["‹"],
        ]);

        await bot.pressButton(chat, "Blue");

        assert.deepEqual(completed, [
            {
                title: "Tea",
                amount: 12.5,
                date: "2026-03-05",
                color: "blue",
            },
        ]);
        assert.deepEqual(bot.readSentTexts(), [
            "Title? Send /cancel to stop.",
            "Note? Send /skip to leave it empty.",
            "Amount?",
            "Send a number from 1 to 1000.",
            "Date?",
            "Color?",
            "Order saved",
        ]);
    });

    void it("stays on a text step when validation fails", async (t) => {
        const bot = await buildOrderBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654372 });

        await bot.sendText(chat, "/order");
        await bot.sendText(chat, "A very long title");
        await bot.sendText(chat, "Tea");

        assert.deepEqual(bot.readSentTexts(), [
            "Title? Send /cancel to stop.",
            "Title is too long.",
            "Note? Send /skip to leave it empty.",
        ]);
    });

    void it("stays on a number step when the text is not a number", async (t) => {
        const bot = await buildOrderBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654373 });

        await reachStep(bot, chat, "amount");
        await bot.sendText(chat, "twelve");

        assert.equal(
            bot.readSentTexts().at(-1),
            telegramLocales.en.invalidNumber,
        );
    });

    void it("takes today's date from the button", async (t) => {
        const completed: Order[] = [];
        const bot = await buildOrderBot(t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654374 });

        await reachStep(bot, chat, "date");
        await bot.pressButton(chat, telegramLocales.en.today);
        await bot.pressButton(chat, "Red");

        assert.equal(completed[0]?.date, formatDate(new Date(), "UTC"));
    });

    void it("takes today's date in the user's time zone", async (t) => {
        const completed: Order[] = [];
        const bot = await buildOrderBot(t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654405 });

        await reachStep(bot, chat, "date");
        await mongo
            .collection("users")
            .updateOne(
                { telegramId: String(chat.id) },
                { $set: { timeZone: "Europe/Kyiv" } },
            );
        t.mock.timers.enable({
            apis: ["Date"],
            now: Date.UTC(2026, 9, 1, 22, 30),
        });
        await bot.pressButton(chat, telegramLocales.en.yesterday);
        await bot.pressButton(chat, "Red");

        assert.equal(completed[0]?.date, "2026-10-01");
    });

    void it("takes today's date in the default time zone", async (t) => {
        const completed: Order[] = [];
        const bot = await buildOrderBot(t, completed, {
            TIME_ZONE: "Europe/Kyiv",
        });
        const chat = buildTelegramPrivateChat({ id: 987654406 });

        await reachStep(bot, chat, "date");
        t.mock.timers.enable({
            apis: ["Date"],
            now: Date.UTC(2026, 8, 30, 22, 30),
        });
        await bot.sendText(chat, "5");
        await bot.pressButton(chat, "Red");

        assert.equal(completed[0]?.date, "2026-10-05");
    });

    void it("stays on a date step when the date doesn't exist", async (t) => {
        const bot = await buildOrderBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654375 });

        await reachStep(bot, chat, "date");
        await bot.sendText(chat, "31.02.2026");

        assert.equal(
            bot.readSentTexts().at(-1),
            telegramLocales.en.invalidDate,
        );
    });

    void it("rejects a button from the page shown before an edit", async (t) => {
        const completed: Order[] = [];
        const bot = await buildOrderBot(t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654392 });

        await reachStep(bot, chat, "color");

        const choiceMessageId =
            bot.telegramApiService.sendMessage.mock.callCount();
        const redButton = bot
            .readLastKeyboard()
            .flat()
            .find(({ text }) => text === "Red");

        assert.ok(redButton);

        await bot.pressButton(chat, "›");
        await bot.sendCallback(chat, redButton.callback_data, choiceMessageId);

        assert.deepEqual(completed, []);
        assert.equal(
            bot.telegramApiService.answerCallbackQuery.mock.calls.at(-1)
                ?.arguments[0].text,
            telegramLocales.en.buttonExpired,
        );
    });

    void it("asks to use the buttons when text arrives at a choice step", async (t) => {
        const bot = await buildOrderBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654376 });

        await reachStep(bot, chat, "color");
        await bot.sendText(chat, "Red");

        assert.equal(
            bot.readSentTexts().at(-1),
            telegramLocales.en.chooseWithButtons,
        );
    });

    void it("cancels the answer quietly when there is nothing to choose", async (t) => {
        const bot = await buildOrderBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654377 });

        await bot.sendText(chat, "/empty");
        await bot.sendText(chat, "hello");

        assert.deepEqual(bot.readSentTexts(), [
            telegramLocales.en.nothingToChoose,
        ]);
    });

    void it("starts a scene from a custom update filter", async (t) => {
        const bot = await buildOrderBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654378 });

        await bot.sendText(chat, "I want to order something");

        assert.deepEqual(bot.readSentTexts(), ["Title? Send /cancel to stop."]);
    });
});

async function buildOrderBot(
    t: TestContext,
    completed: Order[] = [],
    env?: Record<string, string>,
): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        env,
        registerRoutes: (router, sceneEngine) => {
            registerOrderScenes(router, sceneEngine, completed);
        },
    });
}

function registerOrderScenes(
    router: TelegramRouter,
    sceneEngine: TelegramSceneEngine,
    completed: Order[],
) {
    const orderScene = defineScene({
        name: "order",
        state: Type.Object({}),
        ttl: 60_000,
        start: (ctx, scene) => scene.ask("order"),
        inputs: {
            order: {
                payload: orderSchema,
                steps: (step) => [
                    textStep(step, {
                        name: "title",
                        property: "title",
                        prompt: () => "Title? Send /cancel to stop.",
                        validate: (text) => {
                            return text.length > 10
                                ? "Title is too long."
                                : undefined;
                        },
                    }),
                    textStep(step, {
                        name: "note",
                        property: "note",
                        prompt: () => "Note? Send /skip to leave it empty.",
                        optional: true,
                    }),
                    numberStep(step, {
                        name: "amount",
                        property: "amount",
                        prompt: () => "Amount?",
                        range: { min: 1, max: 1000 },
                    }),
                    dateStep(step, {
                        name: "date",
                        property: "date",
                        prompt: () => "Date?",
                    }),
                    choiceStep(step, {
                        name: "color",
                        property: "color",
                        prompt: () => "Color?",
                        pageSize: 2,
                        load: async (_ctx, _input, { offset, limit }) => ({
                            items: colors.slice(offset, offset + limit),
                            total: colors.length,
                        }),
                    }),
                ],
                complete: async (ctx, scene, payload) => {
                    completed.push(payload);
                    await ctx.reply("Order saved");
                    await scene.end();
                },
            },
        },
    });
    const emptyScene = defineScene({
        name: "empty",
        state: Type.Object({}),
        ttl: 60_000,
        start: (ctx, scene) => scene.ask("color"),
        inputs: {
            color: {
                payload: Type.Object({ color: Type.String() }),
                steps: (step) => [
                    choiceStep(step, {
                        name: "color",
                        property: "color",
                        prompt: () => "Color?",
                        load: async () => ({ items: [], total: 0 }),
                    }),
                ],
                complete: async () => undefined,
            },
        },
    });
    const isOrderRequest = (
        update: Update,
    ): update is TelegramTextMessageUpdate =>
        message("text")(update) &&
        update.message.text.toLowerCase().includes("order");

    router.scene(orderScene);
    router.scene(emptyScene);
    router.command("order", (ctx) => sceneEngine.start(ctx, orderScene, {}));
    router.command("empty", (ctx) => sceneEngine.start(ctx, emptyScene, {}));
    router.on(isOrderRequest, (ctx) => sceneEngine.start(ctx, orderScene, {}));
}

async function reachStep(
    bot: TelegramSceneBot,
    chat: ReturnType<typeof buildTelegramPrivateChat>,
    stepName: "amount" | "date" | "color",
): Promise<void> {
    const answers = { amount: [], date: ["12"], color: ["12", "05.03.2026"] };

    await bot.sendText(chat, "/order");
    await bot.sendText(chat, "Tea");
    await bot.sendText(chat, "/skip");

    for (const answer of answers[stepName]) {
        await bot.sendText(chat, answer);
    }
}

function readLabels(
    keyboard: ReturnType<TelegramSceneBot["readLastKeyboard"]>,
): string[][] {
    return keyboard.map((row) => row.map(({ text }) => text));
}
