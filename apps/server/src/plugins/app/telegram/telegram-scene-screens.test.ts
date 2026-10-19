import { Type } from "@sinclair/typebox";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { complete, defineScene } from "./telegram-scene.js";

interface Shop {
    stock: Record<string, number>;
    removed: string[];
    notes: string[];
}

const shopSceneField = `scene:${createHash("sha256")
    .update("shop:shop")
    .digest("base64url")
    .slice(0, 12)}`;

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

void describe("Telegram scene screens", () => {
    void it("shows the root screen and edits its message when the params change", async (t) => {
        const { bot } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654701 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Next");

        assert.deepEqual(bot.readSentTexts(), ["List 0"]);
        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 1"]);
    });

    void it("returns to the previous screen with its params", async (t) => {
        const { bot } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654702 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Next");
        await bot.pressButton(chat, "Open a");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item a: 0",
            "Actions a",
        ]);

        await bot.pressButton(chat, "Back");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 1"]);
        assert.deepEqual(bot.readSentTexts(), ["List 0", "Actions a"]);
    });

    void it("sends the later messages again when an earlier one must be sent anew", async (t) => {
        const { bot } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654703 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        bot.telegramApiService.editMessageText.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request: message to edit not found",
            }),
        );
        await bot.pressButton(chat, "Open b");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item b: 0",
            "Actions b",
        ]);
    });

    void it("replaces a screen, so going back skips it", async (t) => {
        const { bot } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654704 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Form");
        await bot.pressButton(chat, "Save");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item b: 0",
            "Actions b",
        ]);

        await bot.pressButton(chat, "Back");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
    });

    void it("resets to the root screen and forgets the previous screens", async (t) => {
        const { bot } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654705 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Next");
        await bot.pressButton(chat, "Open a");
        await bot.pressButton(chat, "Form");
        await bot.pressButton(chat, "Home");
        await bot.pressButton(chat, "Up");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
    });

    void it("refuses a screen that its guard hides", async (t) => {
        const { bot } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654706 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Secret");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
        assert.deepEqual(
            bot.telegramApiService.answerCallbackQuery.mock.calls.at(-1)
                ?.arguments[0].text,
            undefined,
        );
    });

    void it("runs a confirmed button on the second press only", async (t) => {
        const { bot, shop } = await buildShopBot(t);
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

    void it("forgets a pending confirmation when the user leaves the screen and comes back", async (t) => {
        const { bot, shop } = await buildShopBot(t);
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

    void it("cancels a waiting input when the screen changes", async (t) => {
        const { bot, shop } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654709 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Form");
        await bot.pressButton(chat, "Note");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Form",
            "Note?",
        ]);

        await bot.pressButton(chat, "Back");
        await bot.sendText(chat, "hello");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
        assert.deepEqual(shop.notes, []);
    });

    void it("redraws the screen that watches a published topic", async (t) => {
        const { bot, shop } = await buildShopBot(t);
        const ada = buildTelegramPrivateChat({ id: 987654710 });
        const bob = buildTelegramPrivateChat({ id: 987654711 });

        await bot.sendText(ada, "/shop");
        await bot.pressButton(ada, "Open a");
        await bot.sendText(bob, "/shop");
        shop.stock.a = 1;
        bot.telegramChats.publish(["shop.item:a"]);
        await bot.telegramChats.idle();

        assert.deepEqual(await bot.readMessageTexts(ada.id), [
            "Item a: 1",
            "Actions a",
        ]);
        assert.deepEqual(await bot.readMessageTexts(bob.id), ["List 0"]);
    });

    void it("shows the running scene again on the same screen", async (t) => {
        const { bot } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654712 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await bot.sendText(chat, "/shop");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item a: 0",
            "Actions a",
        ]);
        assert.deepEqual(bot.readSentTexts(), [
            "List 0",
            "Actions a",
            "Item a: 0",
            "Actions a",
        ]);
    });

    void it("drops a scene whose stored screen is no longer defined", async (t) => {
        const { bot } = await buildShopBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654713 });

        await bot.sendText(chat, "/shop");

        const record = await bot.readSessionField(
            chat.id,
            shopSceneField,
            Type.Record(Type.String(), Type.Unknown()),
        );

        await bot.writeSessionField(chat.id, shopSceneField, {
            ...record,
            screen: { name: "gone", params: {} },
        });
        await bot.pressButton(chat, "Next");

        assert.equal(
            bot.telegramApiService.answerCallbackQuery.mock.calls.at(-1)
                ?.arguments[0].text,
            telegramLocales.en.buttonExpired,
        );
    });
});

async function buildShopBot(
    t: TestContext,
): Promise<{ bot: TelegramSceneBot; shop: Shop }> {
    const shop: Shop = { stock: { a: 0, b: 0 }, removed: [], notes: [] };
    const shopScene = defineScene({
        name: "shop",
        state: Type.Object({}),
        ttl: 60_000,
        key: () => "shop",
        root: { name: "list", params: { page: 0 } },
        screens: {
            list: {
                params: Type.Object({ page: Type.Integer({ minimum: 0 }) }),
                watch: () => ["shop.list"],
                render: async (ctx, scene, { page }) => [
                    {
                        kind: "text",
                        text: `List ${page}`,
                        keyboard: [
                            [
                                scene.button("Next", "page", page + 1),
                                scene.screenButton("Open a", "item", {
                                    id: "a",
                                }),
                            ],
                            [
                                scene.screenButton("Form", "form"),
                                scene.screenButton("Secret", "secret"),
                            ],
                            [scene.backButton("Up")],
                        ],
                    },
                ],
            },
            item: {
                params: Type.Object({ id: Type.String() }),
                watch: ({ id }) => [`shop.item:${id}`],
                render: async (ctx, scene, { id }) => [
                    { kind: "text", text: `Item ${id}: ${shop.stock[id]}` },
                    {
                        kind: "text",
                        text: `Actions ${id}`,
                        keyboard: [
                            [
                                scene.screenButton("Form", "form"),
                                scene.screenButton("Open b", "item", {
                                    id: "b",
                                }),
                            ],
                            [
                                scene.backButton("Back"),
                                scene.button(
                                    scene.isConfirming("remove")
                                        ? "Sure?"
                                        : "Remove",
                                    "remove",
                                    id,
                                ),
                            ],
                        ],
                    },
                ],
            },
            form: {
                params: Type.Object({}),
                render: async (ctx, scene) => [
                    {
                        kind: "text",
                        text: "Form",
                        keyboard: [
                            [
                                scene.button("Note", "note", null),
                                scene.button("Save", "save", null),
                            ],
                            [
                                scene.backButton("Back"),
                                scene.button("Home", "home", null),
                            ],
                        ],
                    },
                ],
            },
            secret: {
                params: Type.Object({}),
                guard: () => false,
                render: async () => [{ kind: "text", text: "Secret" }],
            },
        },
        buttons: {
            page: {
                value: Type.Integer({ minimum: 0 }),
                handle: async (ctx, scene, page) => {
                    if (scene.screen.name === "list") {
                        scene.screen.params.page = page;
                    }
                },
            },
            remove: {
                value: Type.String(),
                confirm: true,
                handle: async (ctx, scene, id) => {
                    shop.removed.push(id);
                },
            },
            note: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.ask("note"),
            },
            save: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.replace("item", { id: "b" }),
            },
            home: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.reset(),
            },
        },
        inputs: {
            note: {
                payload: Type.Object({ text: Type.String() }),
                cleanup: true,
                steps: (step) => [
                    step("text", message("text"), {
                        enter: async (ctx) => {
                            await ctx.reply("Note?");
                        },
                        handle: async (ctx) =>
                            complete({ text: ctx.update.message.text }),
                    }),
                ],
                complete: async (ctx, scene, { text }) => {
                    shop.notes.push(text);
                },
            },
        },
    });
    const bot = await buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router, sceneEngine) => {
            router.scene(shopScene);
            router.command("shop", (ctx) =>
                sceneEngine.start(ctx, shopScene, {}),
            );
        },
    });

    return { bot, shop };
}
