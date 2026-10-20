import {
    type Static,
    type TObject,
    type TString,
    Type,
} from "@sinclair/typebox";
import { Redis } from "ioredis";
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
import { setTimeout } from "node:timers/promises";
import { requestLogSerializers } from "../../../request-logging.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import {
    buildSessionKey,
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import {
    anyOf,
    callbackQuery,
    command,
    message,
    text,
} from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramRouter } from "./telegram-router.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import {
    back,
    complete,
    defineScene,
    goto,
    next,
    stay,
    TelegramScene,
    TelegramSceneBlocking,
} from "./telegram-scene.js";
import { TelegramSessionStoreOptions } from "./telegram-session-store.js";

const profileSchema = Type.Object({
    name: Type.String(),
    age: Type.Number(),
    nickname: Type.Optional(Type.String()),
});

type Profile = Static<typeof profileSchema>;

interface SceneLifetime {
    ttl: number;
    maxAge?: number;
}

const profileTtlMilliseconds = 7 * 24 * 60 * 60 * 1000;
const focusSchema = Type.String();
const sceneRecordSchema = Type.Object({
    name: Type.String(),
    state: Type.Record(Type.String(), Type.Unknown()),
});

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

void describe("TelegramSceneEngine inputs", () => {
    void it("walks through the steps and completes with the validated payload", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(t, completed);
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
        const bot = await buildProfileBot(t);
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
        const bot = await buildProfileBot(t);
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
        const bot = await buildProfileBot(t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654354 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "36");
        await bot.sendText(chat, "/skip");

        assert.deepEqual(completed, [{ name: "Ada", age: 36 }]);
    });

    void it("cancels the answer on /cancel", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(t, completed);
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
        const bot = await buildProfileBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654356 });

        await bot.sendText(chat, "/cancel");

        assert.deepEqual(bot.readSentTexts(), [
            telegramLocales.en.nothingToCancel,
        ]);
    });

    void it("keeps the answer in progress when another command runs", async (t) => {
        const bot = await buildProfileBot(t);
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
        const bot = await buildProfileBot(t, completed);
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
        const bot = await buildProfileBot(t);
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
        const bot = await buildProfileBot(t, completed);
        const chat = buildTelegramPrivateChat({ id: 987654360 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "finish");

        assert.deepEqual(completed, []);
        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            telegramLocales.en.error,
        ]);
    });

    void it("logs and skips an invalid stored scene", async (t) => {
        const logs = createLogCollector();
        const bot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            logger: { ...logs.logger, serializers: requestLogSerializers },
            registerRoutes: (router, sceneEngine) => {
                registerProfileScene(
                    router,
                    sceneEngine,
                    defineProfileScene([]),
                );
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654402 });

        await bot.writeSessionField(chat.id, "focus", "stored");
        await bot.writeSessionField(
            chat.id,
            "scene:stored",
            "private-session-text",
        );
        await bot.sendText(chat, "/profile");

        const logOutput = JSON.stringify(logs.readEntries());

        assert.ok(logOutput.includes("Invalid cache value"));
        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
        ]);
    });

    void it("handles a button of the current step", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(t, completed);
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

    void it("rejects a button of a previous step as expired", async (t) => {
        const bot = await buildProfileBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654365 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "ask");
        await bot.sendText(chat, "36");
        await bot.pressButton(chat, "18");
        await bot.sendText(chat, "/cancel");
        await bot.pressButton(chat, "18");

        assert.deepEqual(readAnswerTexts(bot), [
            telegramLocales.en.buttonExpired,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("rejects a button from an earlier visit of the same step", async (t) => {
        const completed: Profile[] = [];
        const bot = await buildProfileBot(t, completed);
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
        assert.deepEqual(readAnswerTexts(bot), [
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("records update and scene metrics", async (t) => {
        const bot = await buildProfileBot(t);
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
            /^telegram_updates_total\{type="message",result="handled"\} 4$/m,
        );
        assert.match(
            body,
            /^lock_wait_seconds_count\{name="telegram-session"\} 4$/m,
        );
    });
});

void describe("TelegramSceneEngine scenes", () => {
    void it("keeps a scene and its state between button presses", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654410 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "+1");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "Count 1",
            "Count 2",
        ]);
        assert.deepEqual(readAnswerTexts(bot), [undefined, undefined]);
    });

    void it("reuses a keyed scene instead of starting it again", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654411 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "+1");
        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "Count 1",
            "Count 2",
        ]);
    });

    void it("handles scene buttons while another scene waits for an answer", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654412 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "+1");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            "Counter main",
            "Count 1",
            "Your age?",
        ]);
    });

    void it("refuses a second answer while another scene waits for one", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654413 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            "Counter main",
            "Your age?",
        ]);
        assert.deepEqual(readAnswerTexts(bot), [telegramLocales.en.inputBusy]);
    });

    void it("deletes the question and the answer after the step when cleanup is on", async (t) => {
        const bot = await buildCounterBot(t);
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

    void it("cancels only the answer of a scene on /cancel and cleans up silently", async (t) => {
        const bot = await buildCounterBot(t);
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

    void it("keeps the changes of a button handler that fails", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654416 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Fail");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            telegramLocales.en.error,
            "Count 101",
        ]);
    });

    void it("keeps the scene and drops the answer when a step fails", async (t) => {
        const bot = await buildCounterBot(t);
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
        const bot = await buildCounterBot(t);
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

    void it("ends the scene when a handler fails after it ends the scene", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654424 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Break");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            telegramLocales.en.error,
        ]);
        assert.equal(
            readAnswerTexts(bot).at(-1),
            telegramLocales.en.buttonExpired,
        );
    });

    void it("refuses the answer of a scene started after an answer in the same handler", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654425 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Ask twice");
        await bot.sendText(chat, "Neo");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "New label?",
            "Renamed to Neo",
        ]);
        assert.deepEqual(readAnswerTexts(bot), [telegramLocales.en.inputBusy]);
    });

    void it("keeps the new answer when a handler fails after it asks", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654427 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        await bot.pressButton(chat, "Ask and fail");
        await bot.sendText(chat, "Neo");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "New label?",
            "New label?",
            telegramLocales.en.error,
            "Renamed to Neo",
        ]);
    });

    void it("drops a stored answer whose input is no longer registered", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654426 });

        await bot.writeSessionField(chat.id, "focus", "stored");
        await bot.writeSessionField(chat.id, "scene:stored", {
            name: "counter",
            startedAt: Date.now(),
            state: { count: 0, label: "main" },
            buttons: { nextId: 1, messages: [] },
            messages: [],
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

        assert.deepEqual(bot.readSentTexts(), [
            telegramLocales.en.nothingToCancel,
        ]);
        assert.equal(
            await bot.readSessionField(chat.id, "focus", focusSchema),
            undefined,
        );
    });

    void it("ends a scene with its answer when the handler also cancels the answer", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654428 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        await bot.pressButton(chat, "Close");
        await bot.pressButton(chat, "+1");
        await bot.sendText(chat, "Neo");

        assert.deepEqual(bot.readSentTexts(), ["Counter main", "New label?"]);
        assert.deepEqual(readAnswerTexts(bot), [
            undefined,
            undefined,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("expires the buttons of an ended scene", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654418 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "End");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), ["Counter main", "Ended"]);
        assert.deepEqual(readAnswerTexts(bot), [
            undefined,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("rejects a stored scene button whose value no longer fits", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654419 });

        await bot.writeSessionField(chat.id, "scene:stored", {
            name: "counter",
            startedAt: Date.now(),
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
        assert.deepEqual(readAnswerTexts(bot), [
            telegramLocales.en.buttonExpired,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("expires a scene after its time to live", async (t) => {
        const bot = await buildCounterBot(t, { ttl: 800 });
        const chat = buildTelegramPrivateChat({ id: 987654420 });

        await bot.sendText(chat, "/counter");
        await setTimeout(400);
        await bot.pressButton(chat, "+1");
        await setTimeout(600);
        await bot.pressButton(chat, "+1");
        await setTimeout(1000);
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "Count 1",
            "Count 2",
        ]);
        assert.deepEqual(readAnswerTexts(bot), [
            undefined,
            undefined,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("ends a scene after its maximum age even while it is used", async (t) => {
        const bot = await buildCounterBot(t, { ttl: 60_000, maxAge: 1200 });
        const chat = buildTelegramPrivateChat({ id: 987654421 });

        await bot.sendText(chat, "/counter");
        await setTimeout(600);
        await bot.pressButton(chat, "+1");
        await setTimeout(1000);
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), ["Counter main", "Count 1"]);
        assert.deepEqual(readAnswerTexts(bot), [
            undefined,
            telegramLocales.en.buttonExpired,
        ]);
    });
});

void describe("TelegramSceneEngine blocking scenes", () => {
    void it("refuses to start other scenes while a blocking scene runs", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654460 });

        await bot.sendText(chat, "/wizard");
        await bot.sendText(chat, "/counter");
        await bot.sendText(chat, "/notes");
        await bot.sendText(chat, "Ada");
        await bot.sendText(chat, "/notes");

        assert.deepEqual(bot.readSentTexts(), [
            "Your answer?",
            "Wizard 0",
            blockedText("Wizard"),
            blockedText("Wizard", "Notes"),
            "Wizard done with Ada",
            "Notes",
            "Notes opened",
        ]);

        const body = await bot.metrics.metrics();

        for (const scene of ["counter", "notes"]) {
            assert.match(
                body,
                new RegExp(
                    `^telegram_scene_events_total\\{scene="${scene}",event="blocked"\\} 1$`,
                    "m",
                ),
            );
        }
    });

    void it("shows the running blocking scene again on a second start", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654461 });

        await bot.sendText(chat, "/wizard");
        await bot.sendText(chat, "/wizard");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), [
            "Your answer?",
            "Wizard 0",
            "Wizard 0",
            "Wizard done with Ada",
        ]);
    });

    void it("ends the blocking scene with its answer on /cancel", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654462 });

        await bot.sendText(chat, "/wizard");
        await bot.sendText(chat, "/cancel");
        await bot.sendText(chat, "/counter");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), [
            "Your answer?",
            "Wizard 0",
            telegramLocales.en.sceneCancelled,
            "Counter main",
        ]);
        assert.deepEqual(
            bot.telegramApiService.editMessageReplyMarkup.mock.calls.map(
                (call) => call.arguments[0],
            ),
            [
                {
                    chat_id: chat.id,
                    message_id: await readSentMessageId(bot, "Wizard 0"),
                },
            ],
        );
        assert.equal(
            await bot.readSessionField(chat.id, "blocking", focusSchema),
            undefined,
        );
    });

    void it("releases the block when the blocking scene expires", async (t) => {
        const bot = await buildWizardBot(t, { ttl: 200 });
        const chat = buildTelegramPrivateChat({ id: 987654463 });

        await bot.sendText(chat, "/wizard");
        await setTimeout(300);
        await bot.sendText(chat, "/counter");

        assert.deepEqual(bot.readSentTexts(), [
            "Your answer?",
            "Wizard 0",
            "Counter main",
        ]);
    });

    void it("doesn't start a blocking scene while another scene waits for an answer", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654464 });

        await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "/wizard");
        await bot.sendText(chat, "/cancel");
        await bot.sendText(chat, "/wizard");

        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            telegramLocales.en.inputBusy,
            telegramLocales.en.sceneCancelled,
            "Your answer?",
            "Wizard 0",
        ]);
    });

    void it("keeps the buttons of other scenes working while a blocking scene runs", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654465 });

        await bot.sendText(chat, "/counter");
        await bot.sendText(chat, "/wizard");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "Your answer?",
            "Wizard 0",
            "Count 1",
        ]);
    });

    void it("refuses the answer of another scene while a blocking scene runs", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654467 });

        await bot.sendText(chat, "/counter");
        await bot.sendText(chat, "/survey");
        await bot.pressButton(chat, "Rename");
        await bot.pressButton(chat, "Answer");
        await bot.sendText(chat, "Ada");
        await bot.pressButton(chat, "Rename");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "Survey",
            "Your survey answer?",
            "Survey done with Ada",
            "New label?",
        ]);
        assert.deepEqual(readAnswerTexts(bot), [
            blockedText("Survey"),
            undefined,
            undefined,
        ]);
    });

    void it("shows a running blocking scene without a key again on a second start", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654468 });

        await bot.sendText(chat, "/survey");
        await bot.sendText(chat, "/survey");

        assert.deepEqual(bot.readSentTexts(), ["Survey", "Survey"]);
    });

    void it("runs the cancel hook of the blocking scene's answer on /cancel", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654469 });

        await bot.sendText(chat, "/survey");
        await bot.pressButton(chat, "Answer");
        await bot.sendText(chat, "/cancel");
        await bot.sendText(chat, "/counter");

        assert.deepEqual(bot.readSentTexts(), [
            "Survey",
            "Your survey answer?",
            "Survey stopped",
            "Counter main",
        ]);
        assert.deepEqual(
            bot.telegramApiService.editMessageReplyMarkup.mock.calls.map(
                (call) => call.arguments[0],
            ),
            [
                {
                    chat_id: chat.id,
                    message_id: await readSentMessageId(bot, "Survey"),
                },
            ],
        );
    });

    void it("stores the blocking scene for the scene's time to live", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654466 });

        await bot.sendText(chat, "/wizard");

        const sceneId = await bot.readSessionField(
            chat.id,
            "blocking",
            focusSchema,
        );

        assert.ok(sceneId);
        assert.ok(
            (await bot.readSessionFieldTtl(chat.id, "blocking")) > 50_000,
        );
    });
});

void describe("TelegramSceneEngine hand over", () => {
    void it("edits the messages of the scene into the next scene", async (t) => {
        const handOvers: boolean[] = [];
        const bot = await buildHandOverBot(t, handOvers);
        const chat = buildTelegramPrivateChat({ id: 987654480 });

        await bot.sendText(chat, "/menu");
        await bot.pressButton(chat, "Open A");

        assert.deepEqual(handOvers, [true]);
        assert.deepEqual(bot.readSentTexts(), ["menu"]);
        assert.deepEqual(
            bot.telegramApiService.editMessageText.mock.calls.map((call) => [
                call.arguments[0].message_id,
                call.arguments[0].text,
            ]),
            [[1, "Item a"]],
        );
        assert.deepEqual(await bot.readMessageTexts(chat.id), ["Item a"]);
    });

    void it("moves a running keyed scene into the messages of the scene", async (t) => {
        const bot = await buildHandOverBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654481 });

        await bot.sendText(chat, "/item");
        await bot.sendText(chat, "/menu");
        await bot.pressButton(chat, "Open A");

        assert.deepEqual(bot.readSentTexts(), ["Item a", "menu"]);
        assert.deepEqual(
            bot.telegramApiService.editMessageText.mock.calls.map((call) => [
                call.arguments[0].message_id,
                call.arguments[0].text,
            ]),
            [[2, "Item a"]],
        );
        assert.deepEqual(await bot.readMessageTexts(chat.id), ["Item a"]);
    });

    void it("hands the messages of a blocking scene over and releases the block", async (t) => {
        const bot = await buildHandOverBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654482 });

        await bot.sendText(chat, "/wizard");
        await bot.pressButton(chat, "Open A");
        await bot.sendText(chat, "/menu");

        assert.deepEqual(bot.readSentTexts(), ["wizard", "menu"]);
        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item a",
            "menu",
        ]);
    });

    void it("cancels the answer of the scene and cleans it up silently", async (t) => {
        const bot = await buildHandOverBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654483 });

        await bot.sendText(chat, "/menu");
        await bot.pressButton(chat, "Name");
        await bot.pressButton(chat, "Open A");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), ["menu", "Name?"]);
        assert.deepEqual(
            bot.telegramApiService.deleteMessages.mock.calls.map(
                (call) => call.arguments[0].message_ids,
            ),
            [[await readSentMessageId(bot, "Name?")]],
        );
    });

    void it("lets the next scene ask in its start hook after a blocking scene hands over", async (t) => {
        const handOvers: boolean[] = [];
        const bot = await buildHandOverBot(t, handOvers);
        const chat = buildTelegramPrivateChat({ id: 987654488 });

        await bot.sendText(chat, "/wizard");
        await bot.pressButton(chat, "Survey");

        assert.deepEqual(handOvers, [true]);
        assert.deepEqual(bot.readSentTexts(), ["wizard", "Answer?"]);
        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Survey",
            "Answer?",
        ]);
    });

    void it("hands over to a blocking scene while the scene waits for an answer", async (t) => {
        const handOvers: boolean[] = [];
        const bot = await buildHandOverBot(t, handOvers);
        const chat = buildTelegramPrivateChat({ id: 987654489 });

        await bot.sendText(chat, "/menu");
        await bot.pressButton(chat, "Name");
        await bot.pressButton(chat, "Survey");

        assert.deepEqual(handOvers, [true]);
        assert.deepEqual(bot.readSentTexts(), ["menu", "Name?", "Answer?"]);
        assert.ok(!readAnswerTexts(bot).includes(telegramLocales.en.inputBusy));
        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Survey",
            "Answer?",
        ]);
    });

    void it("hands a blocking scene without a key over to a new instance of its scene", async (t) => {
        const bot = await buildHandOverBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654490 });

        await bot.sendText(chat, "/setup");
        await bot.pressButton(chat, "Self");
        await bot.pressButton(chat, "Name");

        assert.deepEqual(bot.readSentTexts(), ["setup", "Name?"]);
    });

    void it("keeps the scene and its messages when the guard of the next scene refuses", async (t) => {
        const handOvers: boolean[] = [];
        const bot = await buildHandOverBot(t, handOvers, {
            canOpenItem: false,
        });
        const chat = buildTelegramPrivateChat({ id: 987654484 });

        await bot.sendText(chat, "/menu");
        await bot.pressButton(chat, "Open A");
        await bot.pressButton(chat, "Name");

        assert.deepEqual(handOvers, [false]);
        assert.deepEqual(bot.readSentTexts(), ["menu", "Name?"]);
        assert.equal(
            bot.telegramApiService.editMessageText.mock.callCount(),
            0,
        );
    });

    void it("keeps the scene and its messages when another blocking scene runs", async (t) => {
        const handOvers: boolean[] = [];
        const bot = await buildHandOverBot(t, handOvers);
        const chat = buildTelegramPrivateChat({ id: 987654485 });

        await bot.sendText(chat, "/menu");
        await bot.sendText(chat, "/wall");
        await bot.pressButton(chat, "Open A");

        assert.deepEqual(handOvers, [false]);
        assert.equal(readAnswerTexts(bot).at(-1), blockedText("Wall"));
        assert.deepEqual(await bot.readMessageTexts(chat.id), ["menu"]);
    });

    void it("refuses to hand the messages over to the same scene", async (t) => {
        const bot = await buildHandOverBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654486 });

        await bot.sendText(chat, "/menu");
        await bot.pressButton(chat, "Self");

        assert.deepEqual(bot.readSentTexts(), [
            "menu",
            telegramLocales.en.error,
        ]);
        assert.equal(
            bot.telegramApiService.editMessageText.mock.callCount(),
            0,
        );
    });

    void it("expires the buttons of the scene that handed its messages over", async (t) => {
        const bot = await buildHandOverBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654487 });

        await bot.sendText(chat, "/menu");

        const [nameButton] = bot.readLastKeyboard().flat();

        assert.ok(nameButton);

        await bot.pressButton(chat, "Open A");
        await bot.sendCallback(chat, nameButton.callback_data, 1);

        assert.equal(
            readAnswerTexts(bot).at(-1),
            telegramLocales.en.buttonExpired,
        );
    });
});

void describe("TelegramSceneEngine command messages", () => {
    void it("deletes the command that starts a scene", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654470 });

        const counter = await bot.sendText(chat, "/counter");

        assert.deepEqual(bot.readSentTexts(), ["Counter main"]);
        assert.deepEqual(readDeletedMessageIds(bot), [
            counter.message?.message_id,
        ]);
    });

    void it("deletes the command that shows a running scene again", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654471 });

        const first = await bot.sendText(chat, "/counter");
        const second = await bot.sendText(chat, "/counter");

        assert.deepEqual(readDeletedMessageIds(bot), [
            first.message?.message_id,
            second.message?.message_id,
        ]);
    });

    void it("keeps a command and an answer that start no scene", async (t) => {
        const bot = await buildCounterBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654472 });

        await bot.sendText(chat, "/help");
        const profile = await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(readDeletedMessageIds(bot), [
            profile.message?.message_id,
        ]);
    });

    void it("keeps the command that a blocking scene refuses", async (t) => {
        const bot = await buildWizardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654473 });

        const wizard = await bot.sendText(chat, "/wizard");
        await bot.sendText(chat, "/counter");

        assert.deepEqual(bot.readSentTexts().at(-1), blockedText("Wizard"));
        assert.deepEqual(readDeletedMessageIds(bot), [
            wizard.message?.message_id,
        ]);
    });

    void it("keeps the command that the guard of the scene refuses", async (t) => {
        const bot = await buildNotesBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654474 });

        await bot.sendText(chat, "/vault");

        assert.deepEqual(bot.readSentTexts(), []);
        assert.deepEqual(readDeletedMessageIds(bot), []);
    });

    void it("keeps the command when its handler fails after the start", async (t) => {
        const bot = await buildNotesBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654475 });

        await bot.sendText(chat, "/broken");

        assert.deepEqual(bot.readSentTexts(), [
            "Notes",
            telegramLocales.en.error,
        ]);
        assert.deepEqual(readDeletedMessageIds(bot), []);
    });

    void it("deletes the message of a deep link that starts a scene", async (t) => {
        const bot = await buildNotesBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654476 });

        const link = await bot.sendText(chat, "/start notes_main");

        assert.deepEqual(bot.readSentTexts(), ["Notes"]);
        assert.deepEqual(readDeletedMessageIds(bot), [
            link.message?.message_id,
        ]);
    });
});

void describe("TelegramSceneEngine storage", () => {
    void it("keeps the session lock while a slow update runs", async (t) => {
        const calls: string[] = [];
        const bot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            sessionStoreOptions: { lockTtlMilliseconds: 150 },
            registerRoutes: (router) => {
                router.on(text("slow"), async () => {
                    calls.push("slow:start");
                    await setTimeout(500);
                    calls.push("slow:end");
                });
                router.on(text("fast"), async () => {
                    calls.push("fast");
                });
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654390 });

        await bot.allowUser(chat.id);
        await Promise.all([
            bot.sendText(chat, "slow"),
            setTimeout(50).then(() => bot.sendText(chat, "fast")),
        ]);

        assert.deepEqual(calls, ["slow:start", "slow:end", "fast"]);
    });

    void it("doesn't save the session after the lock is lost", async (t) => {
        const chat = buildTelegramPrivateChat({ id: 987654391 });
        const bot: TelegramSceneBot = await buildTelegramSceneBot({
            databaseName,
            mongoClient,
            t,
            registerRoutes: (router, sceneEngine) => {
                const profileScene = defineProfileScene([]);

                registerProfileScene(router, sceneEngine, profileScene);

                router.command("steal", async (ctx) => {
                    await sceneEngine.start(ctx, profileScene, {});
                    await bot.cache.delete(`${buildSessionKey(chat.id)}:lock`);
                });
            },
        });

        await bot.sendText(chat, "/steal");

        assert.equal(
            await bot.readSessionField(chat.id, "focus", focusSchema),
            undefined,
        );
        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            telegramLocales.en.error,
        ]);
    });

    void it("stores a scene and its answer focus for the scene's time to live", async (t) => {
        const bot = await buildProfileBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654366 });

        await bot.sendText(chat, "/profile");

        const sceneId = await bot.readSessionField(
            chat.id,
            "focus",
            focusSchema,
        );

        assert.ok(sceneId);
        assert.ok(
            (await bot.readSessionFieldTtl(chat.id, "focus")) >
                profileTtlMilliseconds - 60_000,
        );
        assert.ok(
            (await bot.readSessionFieldTtl(chat.id, `scene:${sceneId}`)) >
                profileTtlMilliseconds - 60_000,
        );
    });

    void it("clears a stored scene that is no longer registered", async (t) => {
        const bot = await buildProfileBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654367 });

        await bot.writeSessionField(chat.id, "focus", "stored");
        await bot.writeSessionField(chat.id, "scene:stored", {
            name: "removed",
            startedAt: Date.now(),
            state: {},
            buttons: { nextId: 1, messages: [] },
            input: {
                name: "main",
                step: "first",
                history: [],
                payload: {},
                messageIds: [],
            },
        });

        await bot.sendText(chat, "Ada");

        assert.equal(
            await bot.readSessionField(
                chat.id,
                "scene:stored",
                sceneRecordSchema,
            ),
            undefined,
        );
        assert.equal(
            await bot.readSessionField(chat.id, "focus", focusSchema),
            undefined,
        );
        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("waits for a stale session lock until its TTL runs out", async (t) => {
        const bot = await buildProfileBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654368 });

        await bot.allowUser(chat.id);
        await bot.app
            .getDecorator<Redis>("valkey")
            .set(`${buildSessionKey(chat.id)}:lock`, "other", "PX", 300);
        await bot.sendText(chat, "/profile");

        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
        ]);
    });
});

async function buildProfileBot(
    t: TestContext,
    completed: Profile[] = [],
    sessionStoreOptions?: TelegramSessionStoreOptions,
): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        sessionStoreOptions,
        registerRoutes: (router, sceneEngine) => {
            registerProfileScene(
                router,
                sceneEngine,
                defineProfileScene(completed),
            );
        },
    });
}

function defineProfileScene(completed: Profile[]) {
    return defineScene({
        name: "profile",
        state: Type.Object({}),
        ttl: profileTtlMilliseconds,
        start: (ctx, scene) => scene.ask("profile"),
        inputs: {
            profile: {
                payload: profileSchema,
                steps: (step) => [
                    step("name", message("text"), {
                        enter: async (ctx) => {
                            await ctx.reply("Your name? Send /cancel to stop.");
                        },
                        handle: async (ctx) => {
                            const messageText = ctx.update.message.text;

                            if (messageText === "fail") {
                                throw new Error("Step failed");
                            }

                            if (messageText === "finish") {
                                return complete();
                            }

                            return next({ name: messageText });
                        },
                    }),
                    step("age", anyOf(message("text"), callbackQuery("data")), {
                        enter: async (ctx) => {
                            await ctx.reply("Your age?");
                        },
                        handle: async (ctx, input) => {
                            if (typeof input.pressed === "number") {
                                return next({ age: input.pressed });
                            }

                            const messageText = ctx.update.message?.text;

                            if (messageText === "back") {
                                return back();
                            }

                            if (messageText === "ask") {
                                await ctx.reply("Pick your age", {
                                    reply_markup: {
                                        inline_keyboard: [
                                            [input.button("18", 18)],
                                        ],
                                    },
                                });
                                return stay();
                            }

                            const age = Number(messageText);

                            if (!Number.isInteger(age)) {
                                await ctx.reply("Age must be a number.");
                                return stay();
                            }

                            return next({ age });
                        },
                    }),
                    step("nickname", anyOf(message("text"), command("skip")), {
                        enter: async (ctx) => {
                            await ctx.reply(
                                "Your nickname? Send /skip to leave it empty.",
                            );
                        },
                        handle: async (ctx) => {
                            const messageText = ctx.update.message.text;

                            if (messageText === "restart") {
                                return goto("name");
                            }

                            return messageText === "/skip"
                                ? next()
                                : next({ nickname: messageText });
                        },
                    }),
                ],
                complete: async (ctx, scene, payload) => {
                    completed.push(payload);
                    await ctx.reply(`Profile saved for ${payload.name}`);
                    await scene.end();
                },
                cancel: async (ctx, scene) => {
                    await ctx.reply(ctx.t("telegram:sceneCancelled"));
                    await scene.end();
                },
            },
        },
    });
}

function registerProfileScene(
    router: TelegramRouter,
    sceneEngine: TelegramSceneEngine,
    profileScene: ReturnType<typeof defineProfileScene>,
): void {
    router.scene(profileScene);
    router.command("profile", (ctx) =>
        sceneEngine.start(ctx, profileScene, {}),
    );
    router.command("help", (ctx) => ctx.reply("Help text"));
}

async function buildCounterBot(
    t: TestContext,
    lifetime: SceneLifetime = { ttl: 60_000 },
): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router, sceneEngine) => {
            const profileScene = defineProfileScene([]);
            const counterScene = defineCounterScene(
                sceneEngine,
                profileScene,
                lifetime,
            );

            registerProfileScene(router, sceneEngine, profileScene);
            router.scene(counterScene);
            router.command("counter", (ctx) =>
                sceneEngine.start(ctx, counterScene, {
                    count: 0,
                    label: "main",
                }),
            );
        },
    });
}

function defineCounterScene(
    sceneEngine: TelegramSceneEngine,
    profileScene: ReturnType<typeof defineProfileScene>,
    lifetime: SceneLifetime,
) {
    return defineScene({
        name: "counter",
        state: Type.Object({ count: Type.Number(), label: Type.String() }),
        key: (state) => state.label,
        ...lifetime,
        start: async (ctx, scene) => {
            await ctx.reply(`Counter ${scene.state.label}`, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            scene.button("+1", "add", { step: 1 }),
                            scene.button("Rename", "rename", null),
                            scene.button("Fail", "fail", null),
                            scene.button("End", "end", null),
                            scene.button("Break", "endAndFail", null),
                            scene.button("Ask twice", "askTwice", null),
                            scene.button("Ask and fail", "askAndFail", null),
                            scene.button("Close", "close", null),
                        ],
                    ],
                },
            });
        },
        buttons: {
            add: {
                value: Type.Object({ step: Type.Number() }),
                handle: async (ctx, scene, value) => {
                    scene.state.count += value.step;
                    await ctx.reply(`Count ${scene.state.count}`, {
                        reply_markup: {
                            inline_keyboard: [
                                [scene.button("+1", "add", { step: 1 })],
                            ],
                        },
                    });
                },
            },
            rename: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.ask("rename"),
            },
            fail: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    scene.state.count = 100;
                    throw new Error("Button failed");
                },
            },
            end: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    await scene.end();
                    await ctx.reply("Ended");
                },
            },
            endAndFail: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    await scene.end();
                    throw new Error("Button failed");
                },
            },
            close: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    await scene.end();
                    await sceneEngine.cancel(ctx);
                },
            },
            askAndFail: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    await scene.ask("rename");
                    throw new Error("Button failed");
                },
            },
            askTwice: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    await scene.ask("rename");
                    await sceneEngine.start(ctx, profileScene, {});
                },
            },
        },
        inputs: {
            rename: {
                payload: Type.Object({ label: Type.String() }),
                cleanup: true,
                steps: (step) => [
                    step("label", message("text"), {
                        enter: async (ctx) => {
                            await ctx.reply("New label?");
                        },
                        handle: async (ctx) => {
                            if (ctx.update.message.text === "fail") {
                                throw new Error("Step failed");
                            }

                            return complete({
                                label: ctx.update.message.text,
                            });
                        },
                    }),
                ],
                complete: async (ctx, scene, payload) => {
                    scene.state.label = payload.label;

                    if (payload.label === "boom") {
                        scene.state.count = 100;
                        throw new Error("Complete failed");
                    }

                    await ctx.reply(`Renamed to ${payload.label}`);
                },
            },
        },
    });
}

async function buildWizardBot(
    t: TestContext,
    lifetime: SceneLifetime = { ttl: 60_000 },
): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router, sceneEngine) => {
            const profileScene = defineProfileScene([]);
            const counterScene = defineCounterScene(sceneEngine, profileScene, {
                ttl: 60_000,
            });
            const wizardScene = defineWizardScene(lifetime);
            const surveyScene = defineSurveyScene();
            const notesScene = defineScene({
                name: "notes",
                title: () => "Notes",
                state: Type.Object({}),
                ttl: 60_000,
                start: (ctx) => ctx.reply("Notes"),
            });

            registerProfileScene(router, sceneEngine, profileScene);
            router.scene(counterScene);
            router.scene(wizardScene);
            router.scene(surveyScene);
            router.scene(notesScene);
            router.command("counter", (ctx) =>
                sceneEngine.start(ctx, counterScene, {
                    count: 0,
                    label: "main",
                }),
            );
            router.command("wizard", (ctx) =>
                sceneEngine.start(ctx, wizardScene, { step: 0 }),
            );
            router.command("survey", (ctx) =>
                sceneEngine.start(ctx, surveyScene, {}),
            );
            router.command("notes", async (ctx) => {
                if (await sceneEngine.start(ctx, notesScene, {})) {
                    await ctx.reply("Notes opened");
                }
            });
        },
    });
}

async function buildNotesBot(t: TestContext): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router, sceneEngine) => {
            const notesScene = defineScene({
                name: "notes",
                state: Type.Object({}),
                ttl: 60_000,
                start: (ctx) => ctx.reply("Notes"),
            });
            const vaultScene = defineScene({
                name: "vault",
                state: Type.Object({}),
                ttl: 60_000,
                guard: (user) => user.grants.includes("vip"),
                start: (ctx) => ctx.reply("Vault"),
            });

            router.scene(notesScene);
            router.scene(vaultScene);
            router.command("vault", (ctx) =>
                sceneEngine.start(ctx, vaultScene, {}),
            );
            router.command("broken", async (ctx) => {
                await sceneEngine.start(ctx, notesScene, {});
                throw new Error("Command failed");
            });
            router.deepLink("notes", (ctx) =>
                sceneEngine.start(ctx, notesScene, {}),
            );
        },
    });
}

function defineWizardScene(lifetime: SceneLifetime) {
    return defineScene({
        name: "wizard",
        title: () => "Wizard",
        blocking: true,
        state: Type.Object({ step: Type.Number() }),
        key: () => "wizard",
        ...lifetime,
        start: (ctx, scene) => scene.ask("answer"),
        root: { name: "panel", params: {} },
        screens: {
            panel: {
                params: Type.Object({}),
                render: async (ctx, scene) => [
                    {
                        kind: "text",
                        text: `Wizard ${scene.state.step}`,
                        keyboard: [[scene.button("Skip", "skip", null)]],
                    },
                ],
            },
        },
        buttons: {
            skip: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    scene.state.step += 1;
                },
            },
        },
        inputs: {
            answer: {
                payload: Type.Object({ value: Type.String() }),
                steps: (step) => [
                    step("value", message("text"), {
                        enter: async (ctx) => {
                            await ctx.reply("Your answer?");
                        },
                        handle: async (ctx) =>
                            complete({ value: ctx.update.message.text }),
                    }),
                ],
                complete: async (ctx, scene, payload) => {
                    await ctx.reply(`Wizard done with ${payload.value}`);
                    await scene.end();
                },
            },
        },
    });
}

function defineSurveyScene() {
    return defineScene({
        name: "survey",
        title: () => "Survey",
        blocking: true,
        state: Type.Object({}),
        ttl: 60_000,
        root: { name: "panel", params: {} },
        screens: {
            panel: {
                params: Type.Object({}),
                render: async (ctx, scene) => [
                    {
                        kind: "text",
                        text: "Survey",
                        keyboard: [[scene.button("Answer", "answer", null)]],
                    },
                ],
            },
        },
        buttons: {
            answer: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.ask("answer"),
            },
        },
        inputs: {
            answer: {
                payload: Type.Object({ value: Type.String() }),
                steps: (step) => [
                    step("value", message("text"), {
                        enter: async (ctx) => {
                            await ctx.reply("Your survey answer?");
                        },
                        handle: async (ctx) =>
                            complete({ value: ctx.update.message.text }),
                    }),
                ],
                complete: async (ctx, scene, payload) => {
                    await ctx.reply(`Survey done with ${payload.value}`);
                    await scene.end();
                },
                cancel: async (ctx) => {
                    await ctx.reply("Survey stopped");
                },
            },
        },
    });
}

async function buildHandOverBot(
    t: TestContext,
    handOvers: boolean[] = [],
    { canOpenItem = true }: { canOpenItem?: boolean } = {},
): Promise<TelegramSceneBot> {
    const itemScene = defineScene({
        name: "item",
        state: Type.Object({ itemId: Type.String() }),
        ttl: 60_000,
        guard: () => canOpenItem,
        key: (state) => state.itemId,
        root: { name: "item", params: {} },
        screens: {
            item: {
                params: Type.Object({}),
                render: async (ctx, scene) => [
                    { kind: "text", text: `Item ${scene.state.itemId}` },
                ],
            },
        },
    });
    const surveyScene = defineScene({
        name: "survey",
        title: () => "Survey",
        blocking: true,
        state: Type.Object({}),
        key: () => "survey",
        ttl: 60_000,
        start: (ctx, scene) => scene.ask("answer"),
        root: { name: "survey", params: {} },
        screens: {
            survey: {
                params: Type.Object({}),
                render: async () => [{ kind: "text", text: "Survey" }],
            },
        },
        inputs: {
            answer: {
                payload: Type.Object({ answer: Type.String() }),
                steps: (step) => [
                    step("answer", message("text"), {
                        enter: async (ctx) => {
                            await ctx.reply("Answer?");
                        },
                        handle: async (ctx) =>
                            complete({ answer: ctx.update.message.text }),
                    }),
                ],
                complete: async () => undefined,
            },
        },
    });
    const targets = { itemScene, surveyScene, handOvers };
    const menuScene = defineMenuScene("menu", targets, {}, { isKeyed: true });
    const wizardScene = defineMenuScene(
        "wizard",
        targets,
        { blocking: true, title: () => "Wizard" },
        { isKeyed: true },
    );
    const setupScene = defineMenuScene(
        "setup",
        targets,
        { blocking: true, title: () => "Setup" },
        { isKeyed: false },
    );
    const wallScene = defineScene({
        name: "wall",
        title: () => "Wall",
        blocking: true,
        state: Type.Object({}),
        ttl: 60_000,
    });

    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router, sceneEngine) => {
            router.scene(itemScene);
            router.scene(menuScene);
            router.scene(wizardScene);
            router.scene(setupScene);
            router.scene(surveyScene);
            router.scene(wallScene);
            router.command("item", (ctx) =>
                sceneEngine.start(ctx, itemScene, { itemId: "a" }),
            );
            router.command("menu", (ctx) =>
                sceneEngine.start(ctx, menuScene, {}),
            );
            router.command("wizard", (ctx) =>
                sceneEngine.start(ctx, wizardScene, {}),
            );
            router.command("setup", (ctx) =>
                sceneEngine.start(ctx, setupScene, {}),
            );
            router.command("wall", (ctx) =>
                sceneEngine.start(ctx, wallScene, {}),
            );
        },
    });
}

function defineMenuScene(
    name: string,
    {
        itemScene,
        surveyScene,
        handOvers,
    }: {
        itemScene: TelegramScene<TObject<{ itemId: TString }>>;
        surveyScene: TelegramScene;
        handOvers: boolean[];
    },
    blocking: TelegramSceneBlocking,
    { isKeyed }: { isKeyed: boolean },
): TelegramScene {
    const menuScene: TelegramScene = defineScene({
        name,
        ...blocking,
        ...(isKeyed ? { key: () => name } : {}),
        state: Type.Object({}),
        ttl: 60_000,
        root: { name: "menu", params: {} },
        screens: {
            menu: {
                params: Type.Object({}),
                render: async (ctx, scene) => [
                    {
                        kind: "text",
                        text: name,
                        keyboard: [
                            [
                                scene.button("Name", "name", null),
                                scene.button("Open A", "open", "a"),
                            ],
                            [
                                scene.button("Survey", "survey", null),
                                scene.button("Self", "self", null),
                            ],
                        ],
                    },
                ],
            },
        },
        buttons: {
            name: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.ask("name"),
            },
            open: {
                value: Type.String(),
                handle: async (ctx, scene, itemId) => {
                    handOvers.push(await scene.handOver(itemScene, { itemId }));
                },
            },
            survey: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    handOvers.push(await scene.handOver(surveyScene, {}));
                },
            },
            self: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.handOver(menuScene, {}),
            },
        },
        inputs: {
            name: {
                payload: Type.Object({ name: Type.String() }),
                cleanup: true,
                steps: (step) => [
                    step("name", message("text"), {
                        enter: async (ctx) => {
                            await ctx.reply("Name?");
                        },
                        handle: async (ctx) =>
                            complete({ name: ctx.update.message.text }),
                    }),
                ],
                complete: async () => undefined,
                cancel: async (ctx) => {
                    await ctx.reply("Name cancelled");
                },
            },
        },
    });

    return menuScene;
}

function blockedText(currentTitle: string, nextTitle?: string): string {
    return nextTitle === undefined
        ? telegramLocales.en.sceneBlocked.replace("{{current}}", currentTitle)
        : telegramLocales.en.sceneBlockedStart
              .replace("{{current}}", currentTitle)
              .replace("{{next}}", nextTitle);
}

function readDeletedMessageIds(bot: TelegramSceneBot): number[] {
    return bot.telegramApiService.deleteMessage.mock.calls.map(
        (call) => call.arguments[0].message_id,
    );
}

function readAnswerTexts(bot: TelegramSceneBot): (string | undefined)[] {
    return bot.telegramApiService.answerCallbackQuery.mock.calls.map(
        (call) => call.arguments[0].text,
    );
}

async function readSentMessageId(
    bot: TelegramSceneBot,
    messageText: string,
): Promise<number | undefined> {
    const call = bot.telegramApiService.sendMessage.mock.calls.find(
        (sendCall) => sendCall.arguments[0].text === messageText,
    );
    const response = await call?.result;

    return response?.ok ? response.result.message_id : undefined;
}
