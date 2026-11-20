import { type TObject, type TString, Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import {
    buildSessionKey,
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import {
    buildCounterBot,
    buildWizardBot,
    defineProfileScene,
    readSentMessageId,
    registerProfileScene,
} from "../../../test/telegram-scene-fixtures.js";
import { message } from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import {
    complete,
    defineScene,
    TelegramScene,
    TelegramSceneBlocking,
} from "./telegram-scene.js";

const focusSchema = Type.String();

const testMongo = useTestMongo();

void describe("TelegramSceneRun", () => {
    void it("keeps a scene and its state between button presses", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654410 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "+1");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "Count 1",
            "Count 2",
        ]);
        assert.deepEqual(bot.readAnswerTexts(), [undefined, undefined]);
    });

    void it("reuses a keyed scene instead of starting it again", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
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
        const bot = await buildCounterBot(testMongo, t);
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
        const bot = await buildCounterBot(testMongo, t);
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
        assert.deepEqual(bot.readAnswerTexts(), [telegramLocales.en.inputBusy]);
    });

    void it("keeps the changes of a button handler that fails", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
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

    void it("ends the scene when a handler fails after it ends the scene", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654424 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Break");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            telegramLocales.en.error,
        ]);
        assert.equal(
            bot.readAnswerTexts().at(-1),
            telegramLocales.en.buttonExpired,
        );
    });

    void it("refuses the answer of a scene started after an answer in the same handler", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654425 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Ask twice");
        await bot.sendText(chat, "Neo");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "New label?",
            "Renamed to Neo",
        ]);
        assert.deepEqual(bot.readAnswerTexts(), [telegramLocales.en.inputBusy]);
    });

    void it("keeps the new answer when a handler fails after it asks", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
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

    void it("ends a scene with its answer when the handler also cancels the answer", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654428 });

        await bot.sendText(chat, "/counter");
        await bot.pressButton(chat, "Rename");
        await bot.pressButton(chat, "Close");
        await bot.pressButton(chat, "+1");
        await bot.sendText(chat, "Neo");

        assert.deepEqual(bot.readSentTexts(), ["Counter main", "New label?"]);
        assert.deepEqual(bot.readAnswerTexts(), [
            undefined,
            undefined,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("doesn't save the session after the lock is lost", async (t) => {
        const chat = buildTelegramPrivateChat({ id: 987654391 });
        const bot: TelegramSceneBot = await buildTelegramSceneBot({
            testMongo,
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
        await bot.sendText(chat, "Ada");

        assert.deepEqual(bot.readSentTexts(), [
            "Your name? Send /cancel to stop.",
            telegramLocales.en.error,
        ]);
    });
});

void describe("TelegramSceneRun blocking scenes", () => {
    void it("refuses to start other scenes while a blocking scene runs", async (t) => {
        const bot = await buildWizardBot(testMongo, t);
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
        const bot = await buildWizardBot(testMongo, t);
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
        const bot = await buildWizardBot(testMongo, t);
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
        const bot = await buildWizardBot(testMongo, t, { ttl: 200 });
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
        const bot = await buildWizardBot(testMongo, t);
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
        const bot = await buildWizardBot(testMongo, t);
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
        const bot = await buildWizardBot(testMongo, t);
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
        assert.deepEqual(bot.readAnswerTexts(), [
            blockedText("Survey"),
            undefined,
            undefined,
        ]);
    });

    void it("shows a running blocking scene without a key again on a second start", async (t) => {
        const bot = await buildWizardBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654468 });

        await bot.sendText(chat, "/survey");
        await bot.sendText(chat, "/survey");

        assert.deepEqual(bot.readSentTexts(), ["Survey", "Survey"]);
    });

    void it("runs the cancel hook of the blocking scene's answer on /cancel", async (t) => {
        const bot = await buildWizardBot(testMongo, t);
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

    void it("keeps a cancelled answer cancelled when the end of the blocking scene fails", async (t) => {
        const bot = await buildWizardBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654472 });

        await bot.sendText(chat, "/survey");
        await bot.pressButton(chat, "Answer");
        bot.telegramApiService.editMessageReplyMarkup.mock.mockImplementation(
            () => Promise.reject(new Error("network down")),
        );
        await bot.sendText(chat, "/cancel");
        await bot.sendText(chat, "Late");

        assert.deepEqual(bot.readSentTexts(), [
            "Survey",
            "Your survey answer?",
            "Survey stopped",
            telegramLocales.en.error,
        ]);
    });
});

void describe("TelegramSceneRun hand over", () => {
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
        assert.ok(
            !bot.readAnswerTexts().includes(telegramLocales.en.inputBusy),
        );
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
        assert.equal(bot.readAnswerTexts().at(-1), blockedText("Wall"));
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
            bot.readAnswerTexts().at(-1),
            telegramLocales.en.buttonExpired,
        );
    });
});

void describe("TelegramSceneRun command messages", () => {
    void it("deletes the command that starts a scene", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654470 });

        const counter = await bot.sendText(chat, "/counter");

        assert.deepEqual(bot.readSentTexts(), ["Counter main"]);
        assert.deepEqual(readDeletedMessageIds(bot), [
            counter.message?.message_id,
        ]);
    });

    void it("deletes the command that shows a running scene again", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654471 });

        const first = await bot.sendText(chat, "/counter");
        const second = await bot.sendText(chat, "/counter");

        assert.deepEqual(readDeletedMessageIds(bot), [
            first.message?.message_id,
            second.message?.message_id,
        ]);
    });

    void it("keeps a command and an answer that start no scene", async (t) => {
        const bot = await buildCounterBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654472 });

        await bot.sendText(chat, "/help");
        const profile = await bot.sendText(chat, "/profile");
        await bot.sendText(chat, "Ada");

        assert.deepEqual(readDeletedMessageIds(bot), [
            profile.message?.message_id,
        ]);
    });

    void it("keeps the command that a blocking scene refuses", async (t) => {
        const bot = await buildWizardBot(testMongo, t);
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

async function buildNotesBot(t: TestContext): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        testMongo,
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
        testMongo,
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
