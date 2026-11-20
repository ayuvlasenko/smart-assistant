import { Chat } from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import { TestContext } from "node:test";
import {
    anyOf,
    callbackQuery,
    command,
    message,
} from "../plugins/app/telegram/telegram-filters.js";
import { TelegramRouter } from "../plugins/app/telegram/telegram-router.js";
import { TelegramSceneEngine } from "../plugins/app/telegram/telegram-scene-engine.js";
import { TelegramSceneRecord } from "../plugins/app/telegram/telegram-scene-storage.js";
import {
    back,
    complete,
    defineScene,
    goto,
    next,
    stay,
} from "../plugins/app/telegram/telegram-scene.js";
import { choiceStep } from "../plugins/app/telegram/telegram-steps.js";
import { TestMongo } from "./mongo.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "./telegram-scene-bot.js";

export type Profile = Static<typeof profileSchema>;

export interface SceneLifetime {
    ttl: number;
    maxAge?: number;
}

export interface Shop {
    stock: Record<string, number>;
    removed: string[];
    notes: string[];
    ratings: string[];
    isVip: boolean;
}

export interface ShopBot {
    bot: TelegramSceneBot;
    shop: Shop;
}

export interface StoredSceneFields extends Partial<TelegramSceneRecord> {
    name: string;
    state: Record<string, unknown>;
}

const profileSchema = Type.Object({
    name: Type.String(),
    age: Type.Number(),
    nickname: Type.Optional(Type.String()),
});

const profileTtlMilliseconds = 7 * 24 * 60 * 60 * 1000;

export async function buildProfileBot(
    testMongo: TestMongo,
    t: TestContext,
    completed: Profile[] = [],
): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        testMongo,
        t,
        registerRoutes: (router, sceneEngine) => {
            registerProfileScene(
                router,
                sceneEngine,
                defineProfileScene(completed),
            );
        },
    });
}

export function defineProfileScene(completed: Profile[]) {
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

export function registerProfileScene(
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

export async function buildCounterBot(
    testMongo: TestMongo,
    t: TestContext,
    lifetime: SceneLifetime = { ttl: 60_000 },
): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        testMongo,
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

export async function buildWizardBot(
    testMongo: TestMongo,
    t: TestContext,
    lifetime: SceneLifetime = { ttl: 60_000 },
): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        testMongo,
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

export async function buildGreetBot(
    testMongo: TestMongo,
    t: TestContext,
): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        testMongo,
        t,
        registerRoutes: registerGreetScene,
    });
}

export function registerGreetScene(
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

export async function buildShopBot(
    testMongo: TestMongo,
    t: TestContext,
): Promise<ShopBot> {
    const shop: Shop = {
        stock: { a: 0, b: 0 },
        removed: [],
        notes: [],
        ratings: [],
        isVip: false,
    };
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
                            [
                                scene.screenButton("VIP", "vip"),
                                scene.button(
                                    "Force secret",
                                    "forceSecret",
                                    null,
                                ),
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
                                scene.button("Restock", "restock", id),
                                scene.button("Rate", "rate", null),
                            ],
                            [
                                scene.button(
                                    scene.isConfirming("remove", `${id}-copy`)
                                        ? "Sure? copy"
                                        : "Remove copy",
                                    "remove",
                                    `${id}-copy`,
                                ),
                            ],
                            [
                                scene.backButton("Back"),
                                scene.button(
                                    scene.isConfirming("remove", id)
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
            vip: {
                params: Type.Object({}),
                guard: () => shop.isVip,
                watch: () => ["shop.vip"],
                render: async () => [{ kind: "text", text: "VIP" }],
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
            restock: {
                value: Type.String(),
                handle: async (ctx, scene, id) => {
                    shop.stock[id] = (shop.stock[id] ?? 0) + 1;
                },
            },
            rate: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.ask("rating"),
            },
            forceSecret: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.push("secret"),
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
            rating: {
                payload: Type.Object({ rating: Type.String() }),
                steps: (step) => [
                    choiceStep(step, {
                        name: "rating",
                        property: "rating",
                        prompt: () => "Rating?",
                        load: async () => ({
                            items: [{ label: "Good", value: "good" }],
                            total: 1,
                        }),
                    }),
                ],
                complete: async (ctx, scene, { rating }) => {
                    shop.ratings.push(rating);
                },
            },
        },
    });
    const bot = await buildTelegramSceneBot({
        testMongo,
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

export async function writeStoredScene(
    bot: TelegramSceneBot,
    chat: Chat.PrivateChat,
    id: string,
    fields: StoredSceneFields,
): Promise<void> {
    const record: TelegramSceneRecord = {
        startedAt: Date.now(),
        buttons: { nextId: 1, messages: [] },
        messages: [],
        topics: [],
        ...fields,
    };

    await bot.writeSessionField(chat.id, `scene:${id}`, record);
}

export async function readSentMessageId(
    bot: TelegramSceneBot,
    messageText: string,
): Promise<number | undefined> {
    const call = bot.telegramApiService.sendMessage.mock.calls.find(
        (sendCall) => sendCall.arguments[0].text === messageText,
    );
    const response = await call?.result;

    return response?.ok ? response.result.message_id : undefined;
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
