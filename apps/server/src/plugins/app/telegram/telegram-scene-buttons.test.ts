import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import { buildGreetBot } from "../../../test/telegram-scene-fixtures.js";

const testMongo = useTestMongo();

void describe("TelegramSceneButtons", () => {
    void it("passes the stored value to the scene button and answers the press", async (t) => {
        const bot = await buildGreetBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654381 });

        await bot.sendText(chat, "/greet Ada");
        await bot.pressButton(chat, "Greet Ada");

        assert.deepEqual(bot.readSentTexts(), ["Press the button", "Hi Ada"]);
        assert.deepEqual(bot.readAnswerTexts(), [undefined]);
    });

    void it("keeps the buttons of every message of a scene", async (t) => {
        const bot = await buildGreetBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654382 });

        for (const name of ["A", "B", "C", "D", "E", "F", "G"]) {
            await bot.sendText(chat, `/greet ${name}`);
        }

        await bot.pressButton(chat, "Greet A");

        assert.deepEqual(bot.readSentTexts().slice(-1), ["Hi A"]);
        assert.deepEqual(bot.readAnswerTexts(), [undefined]);
    });
});
