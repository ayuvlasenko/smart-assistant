import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { useTestMongo } from "../../../test/mongo.js";
import { buildPokerBot, PokerBot } from "../../../test/poker-bot.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import {
    buildTelegramPrivateChat,
    testTelegramBotId,
} from "../../../test/telegram-fixtures.js";
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
import { BotEntity } from "./bot-entity.js";
import { BotTokenCipher } from "./bot-token-cipher.js";
import { BotData, BotsRepository } from "./bots-repository.js";

const testMongo = useTestMongo();

void describe("BotsRegistry", () => {
    void it("serves the root bot from the env and the active bots from the database", async (t) => {
        const key = randomBytes(32).toString("base64");
        const cipher = new BotTokenCipher(key);
        const { botsRegistry, botsRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                modules: [],
                env: { BOTS_ENCRYPTION_KEY: key },
            });

        const child = await createBot(botsRepository, {
            telegramId: "42",
            username: "child_bot",
            token: cipher.encrypt("42:child-token"),
        });
        const stopped = await createBot(botsRepository, {
            telegramId: "43",
            username: "stopped_bot",
            token: cipher.encrypt("43:stopped-token"),
        });
        await botsRepository.disable(stopped._id, new Date());

        assert.deepEqual(
            (await botsRegistry.list())
                .map(({ id }) => id)
                .sort((a, b) => a.localeCompare(b)),
            [child._id, botsRegistry.rootId].sort((a, b) => a.localeCompare(b)),
        );
        assert.deepEqual(await botsRegistry.find(botsRegistry.rootId), {
            id: botsRegistry.rootId,
            telegramId: testTelegramBotId,
            token: process.env.TELEGRAM_BOT_TOKEN,
            modules: ["bots"],
            startModule: undefined,
        });
        assert.notEqual(child._id, "42");
        assert.deepEqual(await botsRegistry.find(child._id), {
            id: child._id,
            telegramId: "42",
            token: "42:child-token",
            modules: [],
            startModule: undefined,
        });
    });

    void it("skips a bot whose token it can't decrypt and keeps the root bot", async (t) => {
        const logs = createLoggerCollector();
        const { botsRegistry, botsRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                logger: logs.logger,
                env: {
                    BOTS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
                },
            });

        const child = await createBot(botsRepository, {
            telegramId: "42",
            username: "child_bot",
            token: new BotTokenCipher(
                randomBytes(32).toString("base64"),
            ).encrypt("42:child-token"),
        });

        assert.equal(await botsRegistry.find(child._id), undefined);
        assert.ok(await botsRegistry.find(botsRegistry.rootId));
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) =>
                        entry.msg === "Bot token can't be decrypted" &&
                        entry.botId === child._id,
                ),
        );
        assert.ok(!JSON.stringify(logs.readEntries()).includes("child-token"));
    });

    void it("skips a bot whose stored token belongs to another bot", async (t) => {
        const logs = createLoggerCollector();
        const key = randomBytes(32).toString("base64");
        const { botsRegistry, botsRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                logger: logs.logger,
                env: { BOTS_ENCRYPTION_KEY: key },
            });

        const child = await createBot(botsRepository, {
            telegramId: "42",
            username: "child_bot",
            token: new BotTokenCipher(key).encrypt("43:other-token"),
        });

        assert.equal(await botsRegistry.find(child._id), undefined);
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) =>
                        entry.msg === "Bot token belongs to another bot" &&
                        entry.botId === child._id,
                ),
        );
        assert.ok(!JSON.stringify(logs.readEntries()).includes("other-token"));
    });

    void it("finds a bot that another pod added, by its id and by its Telegram id", async (t) => {
        const key = randomBytes(32).toString("base64");
        const { botsRegistry, botsRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                env: { BOTS_ENCRYPTION_KEY: key },
            });

        const child = await createBot(botsRepository, {
            telegramId: "42",
            username: "child_bot",
            token: new BotTokenCipher(key).encrypt("42:child-token"),
        });

        assert.equal(
            (await botsRegistry.findByTelegramId("42"))?.token,
            "42:child-token",
        );
        assert.equal(
            (await botsRegistry.find(child._id))?.token,
            "42:child-token",
        );
    });

    void it("keeps the root bot and its data when the root token becomes a token of another bot", async (t) => {
        const logs = createLoggerCollector();
        const first = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
        });
        const rootId = first.botsRegistry.rootId;
        const second = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
            logger: logs.logger,
            env: { TELEGRAM_BOT_TOKEN: "777000111:other-root-token" },
        });

        assert.equal(second.botsRegistry.rootId, rootId);
        assert.equal(
            (await second.botsRegistry.find(rootId))?.telegramId,
            "777000111",
        );
        assert.equal(
            await testMongo.mongo.collection("bots").countDocuments({}),
            1,
        );
        assert.ok(
            logs
                .readEntries()
                .some(
                    ({ msg }) =>
                        msg === "Root bot moved to another Telegram bot",
                ),
        );
    });
});

void describe("Bot modules", () => {
    void it("closes the commands and the old buttons of a module that is off, also for an admin", async (t) => {
        const bot = await buildPokerBot({ testMongo, t });
        const admin = buildTelegramPrivateChat({ id: 987656001 });

        await bot.allowUser(admin.id, [adminGrant]);
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
            testMongo,
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
        const allowed = async () => {
            const admin = buildUserEntity({
                botId: botsRegistry.rootId,
                grants: [adminGrant],
            });
            const names: string[] = [];

            for (const { name, guard } of router.listCommands()) {
                if (await isAllowed(guard, admin)) {
                    names.push(name);
                }
            }

            return names.sort((a, b) => a.localeCompare(b));
        };

        assert.deepEqual(await allowed(), ["cancel", "invites", "settings"]);

        await app
            .getDecorator<PokerBot["botsRepository"]>("botsRepository")
            .updateModules(botsRegistry.rootId, ["poker", "ping"]);

        assert.deepEqual(await allowed(), [
            "cancel",
            "invites",
            "ping",
            "poker",
            "settings",
        ]);
    });
});

async function setModules(bot: PokerBot, modules: string[]): Promise<void> {
    await bot.botsRepository.updateModules(bot.botsRegistry.rootId, modules);
}

async function createBot(
    botsRepository: BotsRepository,
    data: BotData,
): Promise<BotEntity> {
    const bot = await botsRepository.createIfMissing(data);

    assert.ok(bot);

    return bot;
}
