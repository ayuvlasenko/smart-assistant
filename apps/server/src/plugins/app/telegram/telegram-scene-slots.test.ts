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
import { message } from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramMessageContent } from "./telegram-responder.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import { complete, defineScene, TelegramScene } from "./telegram-scene.js";

const viewSchema = Type.Union([
    Type.Literal("text"),
    Type.Literal("photo"),
    Type.Literal("rich"),
    Type.Literal("hidden"),
]);
const cardStateSchema = Type.Object({
    count: Type.Number(),
    view: viewSchema,
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

void describe("Telegram scene slots", () => {
    void it("sends the slot when the scene starts and edits it when the state changes", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654430 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "+1");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), ["Count 0"]);
        assert.deepEqual(
            bot.telegramApiService.editMessageText.mock.calls.map((call) => [
                call.arguments[0].message_id,
                call.arguments[0].text,
            ]),
            [
                [1, "Count 1"],
                [1, "Count 2"],
            ],
        );
    });

    void it("leaves the message alone when the slot content stays the same", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654431 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Same");
        await bot.pressButton(chat, "Same");

        assert.equal(
            bot.telegramApiService.editMessageText.mock.callCount(),
            0,
        );
        assert.equal(bot.telegramApiService.sendMessage.mock.callCount(), 1);
    });

    void it("turns text into media with an edit", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654432 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Photo");

        assert.deepEqual(
            bot.telegramApiService.editMessageMedia.mock.calls.map((call) => [
                call.arguments[0].message_id,
                call.arguments[0].media,
            ]),
            [[1, { type: "photo", media: "photo-0", caption: "Count 0" }]],
        );
        assert.equal(bot.telegramApiService.sendPhoto.mock.callCount(), 0);
    });

    void it("edits text into a rich message", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654433 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Rich");

        assert.deepEqual(
            bot.telegramApiService.editMessageText.mock.calls.map((call) => [
                call.arguments[0].message_id,
                call.arguments[0].rich_message,
            ]),
            [[1, { markdown: "# Count 0" }]],
        );
    });

    void it("sends a new message when media turns into text", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654434 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Photo");
        await bot.pressButton(chat, "Text");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(readDeletedMessageIds(bot), [1]);
        assert.deepEqual(bot.readSentTexts(), ["Count 0", "Count 0"]);
        assert.deepEqual(
            bot.telegramApiService.editMessageText.mock.calls.map((call) => [
                call.arguments[0].message_id,
                call.arguments[0].text,
            ]),
            [[2, "Count 1"]],
        );
    });

    void it("sends a new message when Telegram refuses the edit", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654435 });

        bot.telegramApiService.editMessageText.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request: message to edit not found",
            }),
        );

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "+1");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), ["Count 0", "Count 1"]);
        assert.deepEqual(readDeletedMessageIds(bot), [1]);
        assert.deepEqual(
            bot.telegramApiService.editMessageText.mock.calls.map((call) => [
                call.arguments[0].message_id,
                call.arguments[0].text,
            ]),
            [
                [1, "Count 1"],
                [2, "Count 2"],
            ],
        );
    });

    void it("treats an unchanged message as edited", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654436 });

        bot.telegramApiService.editMessageText.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request: message is not modified",
            }),
        );

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), ["Count 0"]);
        assert.deepEqual(readDeletedMessageIds(bot), []);
    });

    void it("removes the buttons of an old message that can't be deleted", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654437 });

        bot.telegramApiService.deleteMessage.mock.mockImplementation(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request: message can't be deleted",
            }),
        );

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Photo");
        await bot.pressButton(chat, "Text");

        assert.deepEqual(
            bot.telegramApiService.editMessageReplyMarkup.mock.calls.map(
                (call) => call.arguments[0],
            ),
            [{ chat_id: chat.id, message_id: 1 }],
        );
        assert.deepEqual(bot.readSentTexts(), ["Count 0", "Count 0"]);
    });

    void it("deletes the slot message when the slot has no content", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654438 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Hide");

        assert.deepEqual(readDeletedMessageIds(bot), [1]);
    });

    void it("moves the slot message down when a keyed scene starts again", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654439 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "+1");
        await bot.sendText(chat, "/card");

        assert.deepEqual(readDeletedMessageIds(bot), [1]);
        assert.deepEqual(bot.readSentTexts(), ["Count 0", "Count 1"]);
    });

    void it("removes the slot buttons when the scene ends", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654440 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "Close");
        await bot.sendCallback(chat, readFirstCallbackData(bot), 1);

        assert.deepEqual(
            bot.telegramApiService.editMessageReplyMarkup.mock.calls.map(
                (call) => call.arguments[0],
            ),
            [{ chat_id: chat.id, message_id: 1 }],
        );
        assert.equal(
            bot.telegramApiService.answerCallbackQuery.mock.calls.at(-1)
                ?.arguments[0].text,
            telegramLocales.en.buttonExpired,
        );
    });

    void it("starts a keyed scene again after the scene ends in the same handler", async (t) => {
        const bot = await buildCardBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654443 });

        await bot.sendText(chat, "/card");
        await bot.pressButton(chat, "+1");
        await bot.pressButton(chat, "Reset");
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), ["Count 0", "Count 0"]);
        assert.deepEqual(readDeletedMessageIds(bot), [1]);
        assert.deepEqual(
            bot.telegramApiService.editMessageText.mock.calls.map((call) => ({
                messageId: call.arguments[0].message_id,
                text: call.arguments[0].text,
            })),
            [
                { messageId: 1, text: "Count 1" },
                { messageId: 2, text: "Count 1" },
            ],
        );
    });

    void it("keeps the message of a slot when a later slot fails", async (t) => {
        const panel = { isFooterBroken: true };
        const bot = await buildPanelBot(t, panel);
        const chat = buildTelegramPrivateChat({ id: 987654441 });

        await bot.sendText(chat, "/panel");
        await bot.pressButton(chat, "Toggle");
        panel.isFooterBroken = false;
        await bot.pressButton(chat, "Toggle");

        assert.deepEqual(bot.readSentTexts(), [
            "Footer",
            "Details",
            telegramLocales.en.error,
        ]);
        assert.deepEqual(readDeletedMessageIds(bot), [2]);
    });

    void it("doesn't render a scene that waits for an answer when another command runs", async (t) => {
        const panel = { isFooterBroken: false };
        const bot = await buildPanelBot(t, panel);
        const chat = buildTelegramPrivateChat({ id: 987654444 });

        await bot.sendText(chat, "/panel");
        await bot.pressButton(chat, "Toggle");
        await bot.pressButton(chat, "Note");
        panel.isFooterBroken = true;
        await bot.sendText(chat, "/ping");

        assert.deepEqual(bot.readSentTexts(), [
            "Footer",
            "Details",
            "Note?",
            "pong",
        ]);
    });
});

async function buildPanelBot(
    t: TestContext,
    panel: { isFooterBroken: boolean },
): Promise<TelegramSceneBot> {
    const panelScene = defineScene({
        name: "panel",
        state: Type.Object({ isOpen: Type.Boolean() }),
        ttl: 60_000,
        slots: {
            details: async (ctx, scene) => {
                if (!scene.state.isOpen) {
                    return undefined;
                }

                return { kind: "text", text: "Details" };
            },
            footer: async (ctx, scene) => {
                if (scene.state.isOpen && panel.isFooterBroken) {
                    throw new Error("Slot failed");
                }

                return {
                    kind: "text",
                    text: "Footer",
                    keyboard: [
                        [
                            scene.button("Toggle", "toggle", null),
                            scene.button("Note", "note", null),
                        ],
                    ],
                };
            },
        },
        buttons: {
            toggle: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    scene.state.isOpen = !scene.state.isOpen;
                },
            },
            note: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.ask("note"),
            },
        },
        inputs: {
            note: {
                payload: Type.Object({ text: Type.String() }),
                steps: (step) => [
                    step("text", message("text"), {
                        enter: async (ctx) => {
                            await ctx.reply("Note?");
                        },
                        handle: async (ctx) =>
                            complete({ text: ctx.update.message.text }),
                    }),
                ],
                complete: async () => undefined,
            },
        },
    });

    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router, sceneEngine) => {
            router.scene(panelScene);
            router.command("panel", (ctx) =>
                sceneEngine.start(ctx, panelScene, { isOpen: false }),
            );
            router.command("ping", (ctx) => ctx.reply("pong"));
        },
    });
}

async function buildCardBot(t: TestContext): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router, sceneEngine) => {
            const cardScene = defineCardScene(sceneEngine);

            router.scene(cardScene);
            router.command("card", (ctx) =>
                sceneEngine.start(ctx, cardScene, { count: 0, view: "text" }),
            );
        },
    });
}

function defineCardScene(
    sceneEngine: TelegramSceneEngine,
): TelegramScene<typeof cardStateSchema> {
    const cardScene: TelegramScene<typeof cardStateSchema> = defineScene({
        name: "card",
        state: cardStateSchema,
        key: () => "card",
        ttl: 60_000,
        slots: {
            card: async (
                ctx,
                scene,
            ): Promise<TelegramMessageContent | undefined> => {
                const { count, view } = scene.state;
                const keyboard = [
                    [
                        scene.button("+1", "add", null),
                        scene.button("Same", "same", null),
                        scene.button("Close", "close", null),
                        scene.button("Reset", "reset", null),
                    ],
                    [
                        scene.button("Text", "view", "text"),
                        scene.button("Photo", "view", "photo"),
                        scene.button("Rich", "view", "rich"),
                        scene.button("Hide", "view", "hidden"),
                    ],
                ];

                switch (view) {
                    case "text":
                        return {
                            kind: "text",
                            text: `Count ${count}`,
                            keyboard,
                        };
                    case "photo":
                        return {
                            kind: "media",
                            media: {
                                type: "photo",
                                media: `photo-${count}`,
                                caption: `Count ${count}`,
                            },
                            keyboard,
                        };
                    case "rich":
                        return {
                            kind: "rich",
                            message: { markdown: `# Count ${count}` },
                            keyboard,
                        };
                    case "hidden":
                        return undefined;
                }
            },
        },
        buttons: {
            add: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    scene.state.count += 1;
                },
            },
            same: {
                value: Type.Null(),
                handle: async () => undefined,
            },
            view: {
                value: viewSchema,
                handle: async (ctx, scene, view) => {
                    scene.state.view = view;
                },
            },
            close: {
                value: Type.Null(),
                handle: (ctx, scene) =>
                    scene.end({ messages: "removeButtons" }),
            },
            reset: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    await scene.end({ messages: "delete" });
                    await sceneEngine.start(ctx, cardScene, {
                        count: 0,
                        view: "text",
                    });
                },
            },
        },
    });

    return cardScene;
}

function readDeletedMessageIds(bot: TelegramSceneBot): number[] {
    return bot.telegramApiService.deleteMessage.mock.calls.map(
        (call) => call.arguments[0].message_id,
    );
}

function readFirstCallbackData(bot: TelegramSceneBot): string {
    const [button] = bot.readLastKeyboard().flat();

    assert.ok(button);

    return button.callback_data;
}
