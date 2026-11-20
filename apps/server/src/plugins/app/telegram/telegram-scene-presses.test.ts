import { Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { useTestMongo } from "../../../test/mongo.js";
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
import {
    buildCounterBot,
    buildGreetBot,
    buildProfileBot,
    buildShopBot,
    Profile,
    writeStoredScene,
} from "../../../test/telegram-scene-fixtures.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramRouter } from "./telegram-router.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import { defineScene } from "./telegram-scene.js";

const sceneRecordSchema = Type.Object({
    name: Type.String(),
    state: Type.Record(Type.String(), Type.Unknown()),
});

const testMongo = useTestMongo();

void describe("TelegramScenePresses", () => {
    void it("answers the press and reports the error when a scene button fails", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
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
        assert.deepEqual(bot.readAnswerTexts(), [undefined]);
    });

    void it("answers a press that nothing handles", async (t) => {
        const bot = await buildGreetBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654386 });

        await bot.sendCallback(chat, "legacy-data", 3);

        assert.deepEqual(bot.readSentTexts(), []);
        assert.deepEqual(bot.readAnswerTexts(), [undefined]);
    });

    void it("answers a press from a user without access", async (t) => {
        const bot = await buildGreetBot(testMongo, t);

        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
            buildTelegramCallbackQueryUpdate({
                from: buildTelegramUser({ id: 987654388 }),
                data: "stored:1",
            }),
        );

        assert.deepEqual(bot.readSentTexts(), []);
        assert.deepEqual(bot.readAnswerTexts(), [undefined]);
    });

    void it("stays silent when Telegram refuses the late answer of an expired press", async (t) => {
        const logs = createLoggerCollector();
        const chat = buildTelegramPrivateChat({ id: 987654398 });
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            logger: logs.logger,
        });

        bot.telegramApiService.answerCallbackQuery.mock.mockImplementation(
            async () => ({
                ok: false,
                error_code: 400,
                description:
                    "Bad Request: query is too old and response timeout expired or query ID is invalid",
            }),
        );

        await bot.allowUser(chat.id);
        await bot.sendCallback(chat, "missing:1");

        assert.deepEqual(bot.readSentTexts(), []);
        assert.ok(
            logs
                .readEntries()
                .some(({ msg }) => msg === "Failed to answer callback query"),
        );
    });

    void it("reports an error once when the session is lost after a press", async (t) => {
        const chat = buildTelegramPrivateChat({ id: 987654397 });
        const bot: TelegramSceneBot = await buildTelegramSceneBot({
            testMongo,
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
            testMongo,
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
});

void describe("TelegramScenePresses expired buttons", () => {
    void it("rejects a button of a previous step as expired", async (t) => {
        const bot = await buildProfileBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654365 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "ask");
        await bot.sendText(chat, "36");
        await bot.pressButton(chat, "18");
        await bot.sendText(chat, "/cancel");
        await bot.pressButton(chat, "18");

        assert.deepEqual(bot.readAnswerTexts(), [
            telegramLocales.en.buttonExpired,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("rejects a button from an earlier visit of the same step", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(testMongo, t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654389 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "ask");
        await bot.sendText(chat, "back");
        await bot.sendText(chat, "Grace");
        await bot.pressButton(chat, "18");
        await bot.sendText(chat, "41");
        await bot.sendText(chat, "/skip");

        assert.deepEqual(completed, [{ name: "Grace", age: 41 }]);
        assert.deepEqual(bot.readAnswerTexts(), [
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("expires the buttons of an ended scene", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654418 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "End");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), ["Counter main", "Ended"]);
        assert.deepEqual(bot.readAnswerTexts(), [
            undefined,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("rejects a stored scene button whose value no longer fits", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654419 });

        await writeStoredScene(bot, chat, "stored", {
            name: "counter",
            state: { count: 0, label: "main" },
            buttons: {
                nextId: 3,
                messages: [
                    {
                        messageId: 7,
                        buttons: {
                            "1": { kind: "scene", name: "add", value: "one" },
                            "2": { kind: "scene", name: "removed", value: 1 },
                        },
                    },
                ],
            },
        });
        await bot.sendCallback(chat, "stored:1", 7);
        await bot.sendCallback(chat, "stored:2", 7);

        assert.deepEqual(bot.readSentTexts(), []);
        assert.deepEqual(bot.readAnswerTexts(), [
            telegramLocales.en.buttonExpired,
            telegramLocales.en.buttonExpired,
        ]);
        const record = await bot.readSessionField(
            chat.id,
            "scene:stored",
            sceneRecordSchema,
        );

        assert.equal(record?.name, "counter");
    });
});

void describe("TelegramScenePresses confirmation", () => {
    void it("runs a confirmed button on the second press only", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654707 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await bot.pressButton(chat, "Remove");

        assert.deepEqual(shop.removed, []);
        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item a: 0",
            "Actions a",
        ]);
        assert.ok((await bot.readButtonLabels(chat.id)).includes("Sure?"));

        await bot.pressButton(chat, "Sure?");

        assert.deepEqual(shop.removed, ["a"]);
        assert.ok((await bot.readButtonLabels(chat.id)).includes("Remove"));
    });

    void it("asks again on a double tap, which sends the first button twice", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654720 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await Promise.all([
            bot.pressButton(chat, "Remove"),
            bot.pressButton(chat, "Remove"),
        ]);

        assert.deepEqual(shop.removed, []);
        assert.ok((await bot.readButtonLabels(chat.id)).includes("Sure?"));

        await bot.pressButton(chat, "Sure?");

        assert.deepEqual(shop.removed, ["a"]);
    });

    void it("colours only the button that waits for its second press", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654719 });
        const styleOf = (label: string) =>
            bot.telegramApiService.editMessageText.mock.calls
                .at(-1)
                ?.arguments[0].reply_markup?.inline_keyboard.flat()
                .find(({ text }) => text === label)?.style;

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await bot.pressButton(chat, "Remove");

        assert.equal(styleOf("Sure?"), "danger");
        assert.equal(styleOf("Remove copy"), undefined);
        assert.equal(styleOf("Restock"), undefined);

        await bot.pressButton(chat, "Restock");

        assert.equal(styleOf("Remove"), undefined);
    });

    void it("forgets a pending confirmation when the user leaves the screen and comes back", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654708 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await bot.pressButton(chat, "Remove");
        await bot.pressButton(chat, "Form");
        await bot.pressButton(chat, "Back");

        assert.ok((await bot.readButtonLabels(chat.id)).includes("Remove"));
        assert.ok(!(await bot.readButtonLabels(chat.id)).includes("Sure?"));

        await bot.pressButton(chat, "Remove");

        assert.deepEqual(shop.removed, []);
    });

    void it("forgets a pending confirmation when another button of the scene is pressed", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654714 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await bot.pressButton(chat, "Remove");
        await bot.pressButton(chat, "Restock");

        assert.ok((await bot.readButtonLabels(chat.id)).includes("Remove"));

        await bot.pressButton(chat, "Remove");

        assert.deepEqual(shop.removed, []);
        assert.deepEqual(shop.stock.a, 1);
    });

    void it("forgets a pending confirmation when an input button is pressed", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654715 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await bot.pressButton(chat, "Rate");
        await bot.pressButton(chat, "Remove");
        await bot.pressButton(chat, "Good");

        assert.deepEqual(shop.ratings, ["good"]);
        assert.ok((await bot.readButtonLabels(chat.id)).includes("Remove"));

        await bot.pressButton(chat, "Remove");

        assert.deepEqual(shop.removed, []);
    });

    void it("asks again when the confirmed button comes back with another value", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654716 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await bot.pressButton(chat, "Remove");
        await bot.pressButton(chat, "Remove copy");

        const labels = await bot.readButtonLabels(chat.id);

        assert.deepEqual(shop.removed, []);
        assert.ok(labels.includes("Sure? copy"));
        assert.ok(labels.includes("Remove"));

        await bot.pressButton(chat, "Sure? copy");

        assert.deepEqual(shop.removed, ["a-copy"]);
    });
});

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
