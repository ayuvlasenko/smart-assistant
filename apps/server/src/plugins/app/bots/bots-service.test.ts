import { ForbiddenError } from "@casl/ability";
import { Chat } from "@grammyjs/types";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it, TestContext } from "node:test";
import { BotsBot, buildBotsBot } from "../../../test/bots-bot.js";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramGetMeResponse,
    buildTelegramPrivateChat,
    testBotId,
} from "../../../test/telegram-fixtures.js";
import { adminGrant } from "../access/access-service.js";
import { UserEntity } from "../users/user-entity.js";
import { BotsConnector } from "./bots-connector.js";

const testMongo = useTestMongo();

const childToken = "42:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const otherToken = "44:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

void describe("BotsService", () => {
    void it("refuses a token that it can't store, one that Telegram rejects and one of another bot", async (t) => {
        const bot = await buildBot(t);
        const keyless = await buildBotsBot({ testMongo, t });
        const admin = buildTelegramPrivateChat({ id: 987657006 });
        const actor = await allowAdmin(bot, admin);
        const rejectedToken = "43:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

        bot.childApis.set(
            "43",
            buildTelegramApiServiceMock({
                t,
                getMeResponse: {
                    ok: false,
                    error_code: 401,
                    description: "Unauthorized",
                },
            }),
        );

        assert.deepEqual(await keyless.botsService.add(actor, childToken), {
            status: "keyMissing",
        });
        assert.deepEqual(await bot.botsService.add(actor, rejectedToken), {
            status: "invalidToken",
        });
        const childId = await addChild(bot, actor);

        assert.deepEqual(await bot.botsService.add(actor, childToken), {
            status: "alreadyAdded",
            botId: childId,
        });
        assert.deepEqual(
            await bot.botsService.replaceToken(actor, childId, otherToken),
            { status: "otherBot" },
        );
    });

    void it("refuses to move a bot to itself and to a bot that is already added", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657011 });
        const actor = await allowAdmin(bot, admin);
        const childId = await addChild(bot, actor);
        const other = await bot.botsService.add(actor, otherToken);

        assert.equal(other.status, "added");
        assert.deepEqual(
            await bot.botsService.move(actor, childId, childToken),
            { status: "sameBot" },
        );
        assert.deepEqual(
            await bot.botsService.move(actor, childId, otherToken),
            { status: "alreadyAdded", botId: other.bot._id },
        );
        assert.equal(
            (await bot.botsRepository.findOneById(childId))?.telegramId,
            "42",
        );
    });

    void it("refuses a move when another bot takes the Telegram bot after the check, and keeps the webhook", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657019 });
        const actor = await allowAdmin(bot, admin);
        const childId = await addChild(bot, actor);
        const other = await bot.botsService.add(actor, otherToken);

        assert.equal(other.status, "added");
        t.mock.method(
            bot.botsRepository,
            "findOneByTelegramId",
            () => Promise.resolve(null),
            { times: 1 },
        );

        assert.deepEqual(
            await bot.botsService.move(actor, childId, otherToken),
            { status: "alreadyAdded", botId: other.bot._id },
        );
        assert.equal(
            (await bot.botsRepository.findOneById(childId))?.telegramId,
            "42",
        );
        assert.equal(
            bot.childApis.get("42")?.deleteWebhook.mock.callCount(),
            0,
        );
    });

    void it("refuses a new token when the bot moves to another Telegram bot after the token is checked", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657020 });
        const actor = await allowAdmin(bot, admin);
        const childId = await addChild(bot, actor);
        const botsConnector =
            bot.app.getDecorator<BotsConnector>("botsConnector");
        const readProfile = botsConnector.readProfile.bind(botsConnector);

        t.mock.method(
            botsConnector,
            "readProfile",
            async (token: string) => {
                const profile = await readProfile(token);

                await bot.botsRepository.moveToTelegramBot(
                    childId,
                    "44",
                    bot.botsRegistry.encrypt(otherToken),
                    "child_44_bot",
                );

                return profile;
            },
            { times: 1 },
        );

        assert.deepEqual(
            await bot.botsService.replaceToken(actor, childId, childToken),
            { status: "otherBot" },
        );

        const moved = await bot.botsRegistry.find(childId);

        assert.equal(moved?.telegramId, "44");
        assert.equal(moved.token, otherToken);
    });

    void it("keeps a bot whose webhook Telegram refused and logs it", async (t) => {
        const logs = createLoggerCollector();
        const bot = await buildBot(t, { logger: logs.logger });
        const actor = await allowAdmin(
            bot,
            buildTelegramPrivateChat({ id: 987657031 }),
        );

        bot.childApis.set(
            "42",
            buildTelegramApiServiceMock({
                t,
                getMeResponse: buildTelegramGetMeResponse({
                    id: 42,
                    username: "child_42_bot",
                }),
                setWebhookResponse: {
                    ok: false,
                    error_code: 400,
                    description: "Bad Request: bad webhook",
                },
            }),
        );

        const result = await bot.botsService.add(actor, childToken);

        assert.equal(result.status, "added");
        assert.ok(await bot.botsRepository.findOneByTelegramId("42"));
        assert.ok(
            logs
                .readEntries()
                .some(
                    ({ msg }) =>
                        msg === "Failed to connect the webhook of a bot",
                ),
        );
    });

    void it("stops and starts a bot once when the press repeats", async (t) => {
        const logs = createLoggerCollector();
        const bot = await buildBot(t, { logger: logs.logger });
        const actor = await allowAdmin(
            bot,
            buildTelegramPrivateChat({ id: 987657033 }),
        );
        const childId = await addChild(bot, actor);
        const childApi = bot.childApis.get("42");

        assert.ok(childApi);
        assert.ok(await bot.botsService.stop(actor, childId));
        assert.equal(await bot.botsService.stop(actor, childId), null);
        assert.equal(childApi.deleteWebhook.mock.callCount(), 1);

        assert.ok(await bot.botsService.start(actor, childId));
        assert.equal(await bot.botsService.start(actor, childId), null);
        assert.equal(childApi.setWebhook.mock.callCount(), 2);
        assert.deepEqual(
            logs
                .readEntries()
                .filter(
                    ({ msg }) => msg === "Bot stopped" || msg === "Bot started",
                )
                .map(({ msg }) => msg),
            ["Bot stopped", "Bot started"],
        );
    });

    void it("refuses to stop, take a token for or move the root bot, and gives it no owner link", async (t) => {
        const bot = await buildBot(t);
        const actor = await allowAdmin(
            bot,
            buildTelegramPrivateChat({ id: 987657032 }),
        );
        const rootId = bot.botsRegistry.rootId;

        await assert.rejects(bot.botsService.stop(actor, rootId), /root bot/);
        await assert.rejects(
            bot.botsService.replaceToken(actor, rootId, childToken),
            /root bot/,
        );
        await assert.rejects(
            bot.botsService.move(actor, rootId, childToken),
            /root bot/,
        );
        assert.equal(
            await bot.botsService.replaceOwnerInvite(actor, rootId),
            null,
        );
    });

    void it("keeps the bots away from an admin of a child bot", async (t) => {
        const bot = await buildBot(t);
        const actor = await allowAdmin(
            bot,
            buildTelegramPrivateChat({ id: 987657033 }),
        );
        const childId = await addChild(bot, actor);
        const { user } = await bot.usersRepository.findOneByTelegramIdOrCreate({
            botId: childId,
            telegramId: "987657034",
            isBanned: false,
            languageCode: "en",
        });
        const childAdmin = await bot.usersRepository.grantAccess(user._id, [
            adminGrant,
        ]);

        await assert.rejects(bot.botsService.list(childAdmin), ForbiddenError);
        await assert.rejects(
            bot.botsService.find(childAdmin, childId),
            ForbiddenError,
        );
        await assert.rejects(
            bot.botsService.stop(childAdmin, childId),
            ForbiddenError,
        );
    });
});

function buildBot(
    t: TestContext,
    options: Partial<Parameters<typeof buildBotsBot>[0]> = {},
): Promise<BotsBot> {
    return buildBotsBot({
        testMongo,
        t,
        env: { BOTS_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
        ...options,
    });
}

async function addChild(bot: BotsBot, actor: UserEntity): Promise<string> {
    const result = await bot.botsService.add(actor, childToken);

    assert.equal(result.status, "added");

    return result.bot._id;
}

async function allowAdmin(
    bot: BotsBot,
    chat: Chat.PrivateChat,
): Promise<UserEntity> {
    await bot.allowUser(chat.id, [adminGrant]);

    const user = await bot.usersRepository.findOneByTelegramId(
        testBotId,
        String(chat.id),
    );

    assert.ok(user);

    return user;
}
