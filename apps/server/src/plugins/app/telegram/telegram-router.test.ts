import { Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import {
    buildTelegramCommandUpdate,
    buildTelegramPrivateChat,
    testBotId,
} from "../../../test/telegram-fixtures.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import { UsersRepository } from "../users/users-repository.js";
import { message, text } from "./telegram-filters.js";
import { TelegramGuard } from "./telegram-guard.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramRouter } from "./telegram-router.js";
import { defineScene, next as nextStep } from "./telegram-scene.js";

const testMongo = useTestMongo();

const isVip: TelegramGuard = (user) => user.grants.includes("vip");

void describe("TelegramRouter", () => {
    void it("handles a command with a bot username suffix", async (t) => {
        const calls: string[] = [];
        const { telegramBots, telegramUpdateHandler, usersRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                registerRoutes: (router) => {
                    router.command("test", async () => {
                        calls.push("test");
                    });
                },
            });

        await createUser(usersRepository, 987654345);
        await telegramUpdateHandler.handle(
            await telegramBots.root(),
            buildCommandUpdate(987654345, "/test@BipBopBot"),
        );

        assert.deepEqual(calls, ["test"]);
    });

    void it("rejects a command registered twice", async (t) => {
        await assert.rejects(
            () =>
                buildTelegramBotServiceTestApp({
                    testMongo,
                    t,
                    registerRoutes: (router) => {
                        router.command("start", async () => undefined);
                    },
                }),
            { message: 'Telegram command "start" is already registered' },
        );
    });

    void it("rejects a command name that Telegram does not accept", async (t) => {
        await Promise.all(
            ["newInvite", "new-invite", "", "a".repeat(33)].map((name) =>
                assert.rejects(
                    () =>
                        buildTelegramBotServiceTestApp({
                            testMongo,
                            t,
                            registerRoutes: (router) => {
                                router.command(name, async () => undefined);
                            },
                        }),
                    {
                        message: `Telegram command "${name}" must match /^[a-z0-9_]{1,32}$/`,
                    },
                ),
            ),
        );
    });

    void it("accepts a command name in snake case", async (t) => {
        const bot = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            registerRoutes: (router) => {
                router.command("new_invite_2", async () => undefined);
            },
        });

        assert.ok(bot.telegramBotService);
    });

    void it("routes by an async predicate that reads the context", async (t) => {
        const calls: string[] = [];
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: (router) => {
                router.when(
                    async (ctx) => {
                        await setTimeout(1);
                        return ctx.user.telegramId === "987654347";
                    },
                    async (ctx) => {
                        calls.push(ctx.user.telegramId);
                    },
                );
            },
        });

        await bot.sendText(buildTelegramPrivateChat({ id: 987654347 }), "hi");
        await bot.sendText(buildTelegramPrivateChat({ id: 987654348 }), "hi");

        assert.deepEqual(calls, ["987654347"]);
        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("doesn't ask a predicate while a scene step handles the update", async (t) => {
        let predicateCalls = 0;
        const echoScene = defineScene({
            name: "echo",
            state: Type.Object({}),
            ttl: 60_000,
            start: (ctx, scene) => scene.ask("text"),
            inputs: {
                text: {
                    payload: Type.Object({ text: Type.String() }),
                    steps: (step) => [
                        step("text", message("text"), {
                            enter: async (ctx) => {
                                await ctx.reply("Say something");
                            },
                            handle: async (ctx) =>
                                nextStep({ text: ctx.update.message.text }),
                        }),
                    ],
                    complete: (ctx, scene, payload) =>
                        ctx.reply(`Echo: ${payload.text}`),
                },
            },
        });
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: (router, sceneEngine) => {
                router.scene(echoScene);
                router.command("echo", (ctx) =>
                    sceneEngine.start(ctx, echoScene, {}),
                );
                router.when(
                    () => {
                        predicateCalls += 1;
                        return true;
                    },
                    (ctx) => ctx.reply("Predicate route"),
                );
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654349 });

        await bot.sendText(chat, "/echo");
        await bot.sendText(chat, "hello");

        assert.equal(predicateCalls, 0);
        assert.deepEqual(bot.readSentTexts(), ["Say something", "Echo: hello"]);
    });

    void it("rejects routes registered after the app is ready", async (t) => {
        const { app } = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
        });
        const router = app.getDecorator<TelegramRouter>("telegramRouter");

        assert.throws(
            () => {
                router.on(text("late"), async () => undefined);
            },
            {
                message:
                    "Telegram routes cannot be registered after the app is ready",
            },
        );
    });
});

void describe("TelegramRouter guards", () => {
    void it("answers a guarded command only to users the guard allows", async (t) => {
        const bot = await buildGuardedRoutesBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654501 });

        await bot.sendText(chat, "/secret");
        await bot.allowUser(chat.id, ["vip"]);
        await bot.sendText(chat, "/secret");

        assert.deepEqual(bot.readSentTexts(), ["secret"]);
    });

    void it("skips a guarded match route for users the guard refuses", async (t) => {
        const bot = await buildGuardedRoutesBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654502 });

        await bot.sendText(chat, "hi");
        await bot.allowUser(chat.id, ["vip"]);
        await bot.sendText(chat, "hi");

        assert.deepEqual(bot.readSentTexts(), ["hi vip"]);
    });
});

void describe("TelegramRouter deep links", () => {
    void it("routes /start with a named payload of a banned user to a deep link that allows banned users", async (t) => {
        const values: string[] = [];
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: (router) => {
                router.deepLink(
                    "invite",
                    async (ctx, value) => {
                        values.push(value);
                        await ctx.reply("welcome");
                    },
                    { allowBanned: true },
                );
            },
        });

        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
            buildCommandUpdate(987654338, "/start invite_secret_A-1"),
        );

        assert.deepEqual(values, ["secret_A-1"]);
        assert.deepEqual(bot.readSentTexts(), ["welcome"]);
    });

    void it("keeps a banned user silent for a deep link without allowBanned or with an unknown name", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: (router) => {
                router.deepLink("poker", async (ctx) => {
                    await ctx.reply("poker");
                });
                router.deepLink(
                    "invite",
                    async (ctx) => {
                        await ctx.reply("welcome");
                    },
                    { allowBanned: true },
                );
            },
        });

        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
            buildCommandUpdate(987654339, "/start poker_42"),
        );
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
            buildCommandUpdate(987654339, "/start unknown_42"),
        );
        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
            buildCommandUpdate(987654339, "/start invite"),
        );

        const user = await bot.usersRepository.findOneByTelegramId(
            testBotId,
            "987654339",
        );

        assert.equal(user?.isBanned, true);
        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("keeps a banned user silent on /start without a payload", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: (router) => {
                router.deepLink(
                    "invite",
                    async (ctx) => {
                        await ctx.reply("welcome");
                    },
                    { allowBanned: true },
                );
            },
        });

        await bot.telegramUpdateHandler.handle(
            await bot.telegramBots.root(),
            buildCommandUpdate(987654340, "/start"),
        );

        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("routes each name to its own deep link and greets on an unknown name", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: (router) => {
                router.deepLink("invite", async (ctx, value) => {
                    await ctx.reply(`invite ${value}`);
                });
                router.deepLink("poker", async (ctx, value) => {
                    await ctx.reply(`poker ${value}`);
                });
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654341 });

        await bot.sendText(chat, "/start invite_abc");
        await bot.sendText(chat, "/start poker_42");
        await bot.sendText(chat, "/start other_1");

        assert.deepEqual(bot.readSentTexts(), [
            "invite abc",
            "poker 42",
            telegramLocales.en.welcome,
        ]);
    });

    void it("stays silent on a deep link whose guard refuses the user instead of the /start answer", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            registerRoutes: (router) => {
                router.deepLink(
                    "vip",
                    async (ctx, value) => {
                        await ctx.reply(`vip ${value}`);
                    },
                    { guard: isVip },
                );
            },
        });

        await bot.sendText(
            buildTelegramPrivateChat({ id: 987654342 }),
            "/start vip_1",
        );

        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("refuses a deep link name twice or with characters outside a-z and 0-9", async (t) => {
        await assert.rejects(
            buildTelegramBotServiceTestApp({
                testMongo,
                t,
                registerRoutes: (router) => {
                    router.deepLink("invite", async () => undefined);
                    router.deepLink("invite", async () => undefined);
                },
            }),
            /Telegram deep link "invite" is already registered/,
        );
        await assert.rejects(
            buildTelegramBotServiceTestApp({
                testMongo,
                t,
                registerRoutes: (router) => {
                    router.deepLink("join_poker", async () => undefined);
                },
            }),
            /Telegram deep link name "join_poker" must match/,
        );
    });
});

function buildGuardedRoutesBot(t: TestContext): Promise<TelegramSceneBot> {
    return buildTelegramSceneBot({
        testMongo,
        t,
        registerRoutes: (router) => {
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
}

async function createUser(
    usersRepository: UsersRepository,
    telegramId: number,
): Promise<void> {
    await usersRepository.findOneByTelegramIdOrCreate({
        botId: testBotId,
        telegramId: String(telegramId),
        isBanned: false,
        languageCode: "en",
    });
}

function buildCommandUpdate(telegramId: number, messageText: string) {
    return buildTelegramCommandUpdate(
        buildTelegramPrivateChat({ id: telegramId }),
        messageText,
    );
}
