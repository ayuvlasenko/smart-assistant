import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildInvitesBot } from "../../../test/invites-bot.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import { telegramLocales } from "../telegram/telegram-locales.js";
import { pingGrant } from "./ping-handlers.js";

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

void describe("/ping", () => {
    void it("answers pong only to users with the ping grant", async (t) => {
        const bot = await buildInvitesBot({ databaseName, mongoClient, t });
        const chat = buildTelegramPrivateChat({ id: 987654901 });

        await bot.sendText(chat, "/ping");
        await mongo
            .collection("users")
            .updateOne(
                { telegramId: String(chat.id) },
                { $set: { grants: [pingGrant] } },
            );
        await bot.sendText(chat, "/ping");

        assert.deepEqual(bot.readSentTexts(), [
            telegramLocales.en.unknown,
            "pong",
        ]);
    });
});
