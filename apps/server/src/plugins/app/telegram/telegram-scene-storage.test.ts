import { Type } from "@sinclair/typebox";
import { Redis } from "ioredis";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { loggerRequestSerializers } from "../../../logger-request.js";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import {
    buildSessionKey,
    buildTelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import {
    buildCounterBot,
    buildWizardBot,
    defineProfileScene,
    registerProfileScene,
    writeStoredScene,
} from "../../../test/telegram-scene-fixtures.js";
import { telegramLocales } from "./telegram-locales.js";

const focusSchema = Type.String();
const sceneRecordSchema = Type.Object({
    name: Type.String(),
    state: Type.Record(Type.String(), Type.Unknown()),
});

const testMongo = useTestMongo();

void describe("TelegramSceneStorage", () => {
    void it("logs and skips an invalid stored scene", async (t) => {
        const logs = createLoggerCollector();
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            logger: { ...logs.logger, serializers: loggerRequestSerializers },
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

    void it("clears a stored scene that is no longer registered", async (t) => {
        const logs = createLoggerCollector();
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            logger: logs.logger,
            registerRoutes: (router, sceneEngine) => {
                registerProfileScene(
                    router,
                    sceneEngine,
                    defineProfileScene([]),
                );
            },
        });
        const chat = buildTelegramPrivateChat({ id: 987654367 });

        await bot.writeSessionField(chat.id, "focus", "stored");
        await writeStoredScene(bot, chat, "stored", {
            name: "removed",
            state: {},
            input: {
                name: "main",
                step: "first",
                history: [],
                payload: {},
                messageIds: [],
            },
        });

        await bot.sendText(chat, "Ada");

        assert.ok(
            !JSON.stringify(logs.readEntries()).includes("Invalid cache value"),
        );

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

    void it("expires a scene after its time to live", async (t) => {
        const bot = await buildCounterBot(testMongo, t, { ttl: 1500 });
        const chat = buildTelegramPrivateChat({ id: 987654420 });

        await bot.sendText(chat, "/counter");
        await setTimeout(800);
        await bot.pressButton(chat, "+1");
        await setTimeout(800);
        await bot.pressButton(chat, "+1");
        await setTimeout(1700);
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), [
            "Counter main",
            "Count 1",
            "Count 2",
        ]);
        assert.deepEqual(bot.readAnswerTexts(), [
            undefined,
            undefined,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("ends a scene after its maximum age even while it is used", async (t) => {
        const bot = await buildCounterBot(testMongo, t, {
            ttl: 60_000,
            maxAge: 1200,
        });
        const chat = buildTelegramPrivateChat({ id: 987654421 });

        await bot.sendText(chat, "/counter");
        await setTimeout(300);
        await bot.pressButton(chat, "+1");
        await setTimeout(1100);
        await bot.pressButton(chat, "+1");

        assert.deepEqual(bot.readSentTexts(), ["Counter main", "Count 1"]);
        assert.deepEqual(bot.readAnswerTexts(), [
            undefined,
            telegramLocales.en.buttonExpired,
        ]);
    });

    void it("leaves nothing in the session once a blocking scene that waits for an answer expires", async (t) => {
        const bot = await buildWizardBot(testMongo, t, { ttl: 200 });
        const chat = buildTelegramPrivateChat({ id: 987654466 });
        const readSession = () =>
            bot.app
                .getDecorator<Redis>("valkey")
                .hgetall(buildSessionKey(chat.id));

        await bot.sendText(chat, "/wizard");

        assert.notDeepEqual(await readSession(), {});

        await setTimeout(300);

        assert.deepEqual(await readSession(), {});
    });
});
