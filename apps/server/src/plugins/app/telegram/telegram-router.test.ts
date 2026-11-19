import { Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import {
    buildTelegramCommandUpdate,
    buildTelegramPrivateChat,
    testBotId,
} from "../../../test/telegram-fixtures.js";
import { buildTelegramSceneBot } from "../../../test/telegram-scene-bot.js";
import { UsersRepository } from "../users/users-repository.js";
import { message, text } from "./telegram-filters.js";
import { TelegramRouter } from "./telegram-router.js";
import { defineScene, next as nextStep } from "./telegram-scene.js";

const testMongo = useTestMongo();

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
