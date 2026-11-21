import { Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import { buildTelegramSceneBot } from "../../../test/telegram-scene-bot.js";
import { message } from "./telegram-filters.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import { defineScene, next } from "./telegram-scene.js";

const testMongo = useTestMongo();

void describe("TelegramSceneEngine", () => {
    void it("refuses a second scene with the same name", async (t) => {
        const sceneEngine = await buildSceneEngine(t);

        sceneEngine.register(buildInputScene("twice", ["first"]));

        assert.throws(() => {
            sceneEngine.register(buildInputScene("twice", ["first"]));
        }, /"twice" is already registered/);
    });

    void it("refuses an input without steps and one with two steps of one name", async (t) => {
        const sceneEngine = await buildSceneEngine(t);

        assert.throws(() => {
            sceneEngine.register(buildInputScene("empty", []));
        }, /input "answer" has no steps/);
        assert.throws(() => {
            sceneEngine.register(buildInputScene("repeated", ["same", "same"]));
        }, /input "answer" has duplicate step names/);
    });

    void it("fails the update that starts a scene nobody registered", async (t) => {
        const logs = createLoggerCollector();
        const unregistered = buildInputScene("unregistered", ["first"]);
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            logger: logs.logger,
            registerRoutes: (router, sceneEngine) => {
                router.command("start_unregistered", async (ctx) => {
                    await sceneEngine.start(ctx, unregistered, {});
                });
            },
        });

        await bot.sendText(
            buildTelegramPrivateChat({ id: 987657102 }),
            "/start_unregistered",
        );

        assert.deepEqual(bot.readSentTexts(), [telegramLocales.en.error]);
        assert.ok(
            logs
                .readEntries()
                .some(({ err }) =>
                    err?.message?.includes(
                        'Telegram scene "unregistered" is not registered',
                    ),
                ),
        );
    });
});

async function buildSceneEngine(t: TestContext): Promise<TelegramSceneEngine> {
    const bot = await buildTelegramSceneBot({ testMongo, t });

    return bot.app.getDecorator<TelegramSceneEngine>("telegramSceneEngine");
}

function buildInputScene(name: string, stepNames: string[]) {
    return defineScene({
        name,
        state: Type.Object({}),
        ttl: 60_000,
        inputs: {
            answer: {
                payload: Type.Object({}),
                steps: (step) =>
                    stepNames.map((stepName) =>
                        step(stepName, message("text"), {
                            enter: async () => undefined,
                            handle: async () => next(),
                        }),
                    ),
                complete: async () => undefined,
            },
        },
    });
}
