import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useTestMongo } from "../../../test/mongo.js";
import {
    buildTelegramPrivateChat,
    testTelegramBotId,
} from "../../../test/telegram-fixtures.js";
import {
    buildCounterBot,
    buildProfileBot,
    Profile,
    readSentMessageId,
    writeStoredScene,
} from "../../../test/telegram-scene-fixtures.js";
import { telegramLocales } from "./telegram-locales.js";

const testMongo = useTestMongo();

void describe("TelegramSceneInputs", () => {
    void it("walks through the steps and completes with the validated payload", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(testMongo, t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654351 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "36");
        await bot.sendText(chat, "ada");
        await bot.sendText(chat, "hello");

        assert.deepEqual(completed, [
            { name: "Ada", age: 36, nickname: "ada" },
        ]);
        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            "Your age?",
            "Your nickname? Send /skip to leave it empty.",
            "Profile saved for Ada",
        ]);
    });

    void it("stays on the step when the step rejects the input", async (t) => {
        const bot = await buildProfileBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654352 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "old");
        await bot.sendText(chat, "36");

        assert.deepEqual(bot.readSentTexts().slice(2), [
            "Age must be a number.",
            "Your nickname? Send /skip to leave it empty.",
        ]);
    });

    void it("replies with a hint when the step doesn't accept the update", async (t) => {
        const bot = await buildProfileBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654353 });

        await bot.sendText(chat, "/profile");
        await bot.sendPhoto(chat);
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            telegramLocales.en.sceneUnexpected,
            "Your age?",
        ]);
    });

    void it("accepts a command that the step declares", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(testMongo, t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654354 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "36");
        await bot.sendText(chat, "/skip");

        assert.deepEqual(completed, [{ name: "Ada", age: 36 }]);
    });

    void it("cancels the answer on /cancel", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(testMongo, t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654355 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "/cancel");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(completed, []);
        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            telegramLocales.en.sceneCancelled,
        ]);
    });

    void it("replies that there is nothing to cancel without an answer in progress", async (t) => {
        const bot = await buildProfileBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654356 });

        await bot.sendText(chat, "/cancel");

        assert.deepEqual(bot.readSentTexts(), [
            telegramLocales.en.nothingToCancel,
        ]);
    });

    void it("keeps the answer in progress when another command runs", async (t) => {
        const bot = await buildProfileBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654357 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "/help");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            "Help text",
            "Your age?",
        ]);
    });

    void it("returns to the previous step on back and jumps on goto", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(testMongo, t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654358 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "back");
        await bot.sendText(chat, "Grace");
        await bot.sendText(chat, "85");
        await bot.sendText(chat, "restart");
        await bot.sendText(chat, "Alan");
        await bot.sendText(chat, "41");
        await bot.sendText(chat, "/skip");

        assert.deepEqual(completed, [{ name: "Alan", age: 41 }]);
        assert.deepEqual(bot.readSentTexts().slice(0, 4), [
            "Your name? Send /cancel to stop.",
            "Your age?",
            "Your name? Send /cancel to stop.",
            "Your age?",
        ]);
    });

    void it("drops the answer and replies with an error when a step fails", async (t) => {
        const bot = await buildProfileBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654359 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "fail");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            telegramLocales.en.error,
        ]);
    });

    void it("fails the answer when the payload doesn't match the schema", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(testMongo, t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654360 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "finish");

        assert.deepEqual(completed, []);
        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            telegramLocales.en.error,
        ]);
    });

    void it("handles a button of the current step", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(testMongo, t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654364 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "ask");
        await bot.pressButton(chat, "18");
        await bot.sendText(chat, "/skip");

        assert.deepEqual(completed, [{ name: "Ada", age: 18 }]);
        assert.equal(
            bot.telegramApiService.answerCallbackQuery.mock.callCount(),
            1,
        );
    });

    void it("records update and scene metrics", async (t) => {
        const bot = await buildProfileBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654369 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "36");
        await bot.sendText(chat, "/skip");

        const body = await bot.metrics.metrics();

        for (const [event, count] of [
            ["start", 1],
            ["ask", 1],
            ["next", 3],
            ["complete", 1],
            ["end", 1],
        ] as const) {
            assert.match(
                body,
                new RegExp(
                    `^telegram_scene_events_total\\{scene="profile",event="${event}"\\} ${count}$`,
                    "m",
                ),
            );
        }
        assert.match(
            body,
            new RegExp(
                `^telegram_updates_total\\{type="message",result="handled",bot="${testTelegramBotId}"\\} 4$`,
                "m",
            ),
        );
        assert.match(
            body,
            /^lock_wait_seconds_count\{name="telegram-session"\} 4$/m,
        );
    });

    void it("keeps the scene and drops the answer when a step fails", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654417 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        await bot.sendText(chat, "fail");
        await bot.sendText(chat, "Neo");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "New label?",
            telegramLocales.en.error,
            "Count 1",
        ]);
    });

    void it("drops the answer and keeps the changes when it fails to complete", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654423 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        await bot.sendText(chat, "boom");
        await bot.sendText(chat, "Neo");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "New label?",
            telegramLocales.en.error,
            "Count 101",
        ]);
    });

    void it("drops a stored answer whose input is no longer registered", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654426 });

        await bot.writeSessionField(chat.id, "focus", "stored");
        await writeStoredScene(bot, chat, "stored", {
            name: "counter",
            state: { count: 0, label: "main" },
            buttons: {
                nextId: 2,
                messages: [
                    {
                        messageId: 7,
                        buttons: {
                            "1": {
                                kind: "scene",
                                name: "add",
                                value: { step: 1 },
                            },
                        },
                    },
                ],
            },
            input: {
                name: "removed",
                step: "first",
                history: [],
                payload: {},
                messageIds: [],
            },
        });
        await bot.sendText(chat, "/cancel");
        await bot.sendText(chat, "Ada");
        await bot.sendCallback(chat, "stored:1", 7);
        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Grace");

        assert.deepEqual(bot.readSentTexts(), [
            telegramLocales.en.nothingToCancel,
            "Count 1",
            "Your name? Send /cancel to stop.",
            "Your age?",
        ]);
    });
});

void describe("TelegramSceneInputs cleanup", () => {
    void it("deletes the question and the answer after the step when cleanup is on", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654414 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        const answer = await bot.sendText(chat, "Neo");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "New label?",
            "Renamed to Neo",
            "Count 1",
        ]);
        assert.deepEqual(
            bot.telegramApiService.deleteMessages.mock.calls.map(
                (call) => call.arguments[0],
            ),
            [
                {
                    chat_id: chat.id,
                    message_ids: [
                        await readSentMessageId(bot, "New label?"),
                        answer.message?.message_id,
                    ],
                },
            ],
        );
    });

    void it("takes no text as the answer after /cancel of a scene that does not block", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654418 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        await bot.sendText(chat, "/cancel");
        await bot.sendText(chat, "Neo");

        assert.deepEqual(bot.readSentTexts(), ["Counter main", "New label?"]);
    });

    void it("deletes an unexpected message and its hint with the step when cleanup is on", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654419 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        const photo = await bot.sendPhoto(chat);
        const answer = await bot.sendText(chat, "Neo");

        assert.deepEqual(
            bot.telegramApiService.deleteMessages.mock.calls.map(
                (call) => call.arguments[0].message_ids,
            ),
            [
                [
                    await readSentMessageId(bot, "New label?"),
                    photo.message?.message_id,
                    await readSentMessageId(
                        bot,
                        telegramLocales.en.sceneUnexpected,
                    ),
                    answer.message?.message_id,
                ],
            ],
        );
    });

    void it("cancels only the answer of a scene on /cancel and cleans up silently", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654415 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        const cancel = await bot.sendText(chat, "/cancel");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "New label?",
            "Count 1",
        ]);
        assert.deepEqual(
            bot.telegramApiService.deleteMessages.mock.calls.map(
                (call) => call.arguments[0].message_ids,
            ),
            [
                [
                    await readSentMessageId(bot, "New label?"),
                    cancel.message?.message_id,
                ],
            ],
        );
    });
});
