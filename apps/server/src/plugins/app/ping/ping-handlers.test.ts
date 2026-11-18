import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInvitesBot } from "../../../test/invites-bot.js";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import { pingGrant } from "./ping-handlers.js";

const testMongo = useTestMongo();

void describe("/ping", () => {
    void it("answers pong only to users with the ping grant", async (t) => {
        const bot = await buildInvitesBot({ testMongo, t });
        const chat = buildTelegramPrivateChat({ id: 987654901 });

        await bot.sendText(chat, "/ping");
        await testMongo.mongo
            .collection("users")
            .updateOne(
                { telegramId: String(chat.id) },
                { $set: { grants: [pingGrant] } },
            );
        await bot.sendText(chat, "/ping");

        assert.deepEqual(bot.readSentTexts(), ["pong"]);
    });
});
