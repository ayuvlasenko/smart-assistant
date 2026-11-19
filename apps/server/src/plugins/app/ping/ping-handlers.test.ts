import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import { buildTelegramSceneBot } from "../../../test/telegram-scene-bot.js";
import pingHandlersPlugin, { pingGrant } from "./ping-handlers.js";

const testMongo = useTestMongo();

void describe("/ping", () => {
    void it("answers pong only to users with the ping grant", async (t) => {
        const bot = await buildTelegramSceneBot({
            testMongo,
            t,
            plugins: [pingHandlersPlugin],
        });
        const chat = buildTelegramPrivateChat({ id: 987654901 });

        await bot.sendText(chat, "/ping");
        await bot.allowUser(chat.id, [pingGrant]);
        await bot.sendText(chat, "/ping");

        assert.deepEqual(bot.readSentTexts(), ["pong"]);
    });
});
