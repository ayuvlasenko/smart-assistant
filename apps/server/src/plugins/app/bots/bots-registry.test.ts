import { Chat } from "@grammyjs/types";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildPokerBot, PokerBot } from "../../../test/poker-bot.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { adminGrant } from "../access/access-service.js";
import invitesHandlersPlugin from "../invites/invites-handlers.js";
import invitesRepositoryPlugin from "../invites/invites-repository.js";
import invitesServicePlugin from "../invites/invites-service.js";
import pingHandlersPlugin from "../ping/ping-handlers.js";
import pokerHandlersPlugin from "../poker/poker-handlers.js";
import { pokerLocales } from "../poker/poker-locales.js";
import pokerRoomsRepositoryPlugin from "../poker/poker-rooms-repository.js";
import pokerRoomsServicePlugin from "../poker/poker-rooms-service.js";
import settingsHandlersPlugin from "../settings/settings-handlers.js";
import { isAllowed } from "../telegram/telegram-guard.js";
import { TelegramRouter } from "../telegram/telegram-router.js";
import { BotTokenCipher } from "./bot-token-cipher.js";

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
    await mongo.collection("bots").deleteMany({});
    await mongo.collection("users").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

void describe("BotsRegistry", () => {
    void it("serves the root bot from the env and the active bots from the database", async (t) => {
        const key = randomBytes(32).toString("base64");
        const cipher = new BotTokenCipher(key);
        const { botsRegistry, botsRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                modules: [],
                env: { BOTS_ENCRYPTION_KEY: key },
            });

        await botsRepository.createIfMissing({
            _id: "42",
            username: "child_bot",
            token: cipher.encrypt("42:child-token"),
        });
        await botsRepository.createIfMissing({
            _id: "43",
            username: "stopped_bot",
            token: cipher.encrypt("43:stopped-token"),
        });
        await botsRepository.disable("43", new Date());
        await botsRegistry.refresh();

        assert.deepEqual(
            botsRegistry
                .list()
                .map(({ id }) => id)
                .sort((a, b) => a.localeCompare(b)),
            ["42", botsRegistry.rootId].sort((a, b) => a.localeCompare(b)),
        );
        assert.deepEqual(botsRegistry.find(botsRegistry.rootId), {
            id: botsRegistry.rootId,
            token: process.env.TELEGRAM_BOT_TOKEN,
            modules: ["bots"],
        });
        assert.deepEqual(botsRegistry.find("42"), {
            id: "42",
            token: "42:child-token",
            modules: [],
        });
    });

    void it("skips a bot whose token it can't decrypt and keeps the root bot", async (t) => {
        const logs = createLogCollector();
        const { botsRegistry, botsRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                logger: logs.logger,
                env: {
                    BOTS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
                },
            });

        await botsRepository.createIfMissing({
            _id: "42",
            username: "child_bot",
            token: new BotTokenCipher(
                randomBytes(32).toString("base64"),
            ).encrypt("42:child-token"),
        });
        await botsRegistry.refresh();

        assert.equal(botsRegistry.find("42"), undefined);
        assert.ok(botsRegistry.find(botsRegistry.rootId));
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) =>
                        entry.msg === "Bot token can't be decrypted" &&
                        entry.botId === "42",
                ),
        );
        assert.ok(!JSON.stringify(logs.readEntries()).includes("child-token"));
    });

    void it("skips a bot whose stored token belongs to another bot", async (t) => {
        const logs = createLogCollector();
        const key = randomBytes(32).toString("base64");
        const { botsRegistry, botsRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                logger: logs.logger,
                env: { BOTS_ENCRYPTION_KEY: key },
            });

        await botsRepository.createIfMissing({
            _id: "42",
            username: "child_bot",
            token: new BotTokenCipher(key).encrypt("43:other-token"),
        });
        await botsRegistry.refresh();

        assert.equal(botsRegistry.find("42"), undefined);
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) =>
                        entry.msg === "Bot token belongs to another bot" &&
                        entry.botId === "42",
                ),
        );
        assert.ok(!JSON.stringify(logs.readEntries()).includes("other-token"));
    });

    void it("loads a bot that another pod added after the last refresh", async (t) => {
        const key = randomBytes(32).toString("base64");
        const { botsRegistry, botsRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                env: { BOTS_ENCRYPTION_KEY: key },
            });

        await botsRepository.createIfMissing({
            _id: "42",
            username: "child_bot",
            token: new BotTokenCipher(key).encrypt("42:child-token"),
        });

        assert.equal(botsRegistry.find("42"), undefined);
        assert.equal((await botsRegistry.load("42"))?.token, "42:child-token");
        assert.equal(botsRegistry.find("42")?.token, "42:child-token");
    });
});

void describe("Bot modules", () => {
    void it("closes the commands and the old buttons of a module that is off, also for an admin", async (t) => {
        const bot = await buildPokerBot({ databaseName, mongoClient, t });
        const admin = buildTelegramPrivateChat({ id: 987656001 });

        await allowAdmin(bot, admin);
        await bot.sendText(admin, "/poker");

        const shown = await bot.readMessageTexts(admin.id);

        assert.equal(shown.length, 1);

        await setModules(bot, []);
        await bot.pressButton(admin, pokerLocales.en.newRoomButton);
        await bot.sendText(admin, "/poker");

        assert.deepEqual(await bot.readMessageTexts(admin.id), shown);

        await setModules(bot, ["poker"]);
        await bot.pressButton(admin, pokerLocales.en.newRoomButton);

        assert.notDeepEqual(await bot.readMessageTexts(admin.id), shown);
    });

    void it("leaves only the commands of the core to an admin of a bot without modules", async (t) => {
        const { app, botsRegistry } = await buildTelegramBotServiceTestApp({
            databaseName,
            mongoClient,
            t,
            modules: [],
            plugins: [
                pingHandlersPlugin,
                pokerRoomsRepositoryPlugin,
                pokerRoomsServicePlugin,
                pokerHandlersPlugin,
                invitesRepositoryPlugin,
                invitesServicePlugin,
                invitesHandlersPlugin,
                settingsHandlersPlugin,
            ],
        });
        const router = app.getDecorator<TelegramRouter>("telegramRouter");
        const allowed = () => {
            const admin = buildUserEntity({
                botId: botsRegistry.rootId,
                grants: [adminGrant],
            });

            return router
                .listCommands()
                .filter(({ guard }) => isAllowed(guard, admin))
                .map(({ name }) => name)
                .sort((a, b) => a.localeCompare(b));
        };

        assert.deepEqual(allowed(), ["cancel", "invites", "settings"]);

        const bot = await app
            .getDecorator<PokerBot["botsRepository"]>("botsRepository")
            .updateModules(botsRegistry.rootId, ["poker", "ping"]);

        assert.ok(bot);
        botsRegistry.put(bot);

        assert.deepEqual(allowed(), [
            "cancel",
            "invites",
            "ping",
            "poker",
            "settings",
        ]);
    });
});

async function allowAdmin(
    bot: PokerBot,
    chat: Chat.PrivateChat,
): Promise<void> {
    await bot.allowUser(chat.id);
    await mongo
        .collection("users")
        .updateOne(
            { telegramId: String(chat.id) },
            { $set: { grants: [adminGrant] } },
        );
}

async function setModules(bot: PokerBot, modules: string[]): Promise<void> {
    const updated = await bot.botsRepository.updateModules(
        bot.botsRegistry.rootId,
        modules,
    );

    assert.ok(updated);
    bot.botsRegistry.put(updated);
}
