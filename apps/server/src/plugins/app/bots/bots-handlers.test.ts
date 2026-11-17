import { Chat } from "@grammyjs/types";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
    after,
    before,
    beforeEach,
    describe,
    it,
    TestContext,
} from "node:test";
import { Env } from "../../../env.js";
import { BotsBot, buildBotsBot } from "../../../test/bots-bot.js";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramPrivateChat,
    buildTelegramTextMessageUpdate,
    buildTelegramUser,
    testBotId,
} from "../../../test/telegram-fixtures.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { AccessService, adminGrant } from "../access/access-service.js";
import pingHandlersPlugin from "../ping/ping-handlers.js";
import { pingLocales } from "../ping/ping-locales.js";
import pokerHandlersPlugin, {
    pokerJoinGrant,
} from "../poker/poker-handlers.js";
import { pokerLocales } from "../poker/poker-locales.js";
import pokerRoomsRepositoryPlugin from "../poker/poker-rooms-repository.js";
import pokerRoomsServicePlugin from "../poker/poker-rooms-service.js";
import { resolveTelegramWebhookUrl } from "../telegram/telegram-bot-service.js";
import { telegramLocales } from "../telegram/telegram-locales.js";
import { telegramWebhookSecret } from "../telegram/telegram-webhook-secret.js";
import { UserEntity } from "../users/user-entity.js";
import { BotsSubjects } from "./bot-entity.js";
import { botsLocales } from "./bots-locales.js";

let databaseName!: string;
let mongoClient!: MongoClient;
let mongo!: Db;

const en = botsLocales.en;
const childToken = "42:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const childLabel = "@child_42_bot";
const otherToken = "44:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
let nextUpdateId = 5_000_000;

before(async () => {
    const testMongo = await buildTestMongo();

    databaseName = testMongo.databaseName;
    mongoClient = testMongo.client;
    mongo = testMongo.mongo;
});

beforeEach(async () => {
    await mongo.collection("bots").deleteMany({});
    await mongo.collection("users").deleteMany({});
    await mongo.collection("invites").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

void describe("/bots", () => {
    void it("adds a bot from its token, deletes the token message and shows a link for its owner", async (t) => {
        const logs = createLoggerCollector();
        const bot = await buildBot(t, { logger: logs.logger });
        const admin = buildTelegramPrivateChat({ id: 987657001 });

        await allowAdmin(bot, admin);
        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, en.addButton);

        const answer = await bot.sendText(admin, childToken);
        const stored = await bot.botsRepository.findOneByTelegramId("42");
        const childApi = bot.childApis.get("42");

        assert.ok(stored);
        assert.notEqual(stored._id, "42");

        const invite = await mongo
            .collection("invites")
            .findOne({ botId: stored._id });

        assert.ok(invite);

        assert.equal(stored.username, "child_42_bot");
        assert.ok(!JSON.stringify(stored).includes(childToken));
        assert.ok(
            readDeletedIds(bot).includes(answer.message?.message_id ?? 0),
        );
        assert.deepEqual(
            childApi?.setWebhook.mock.calls.map(
                ({ arguments: [args] }) => args,
            ),
            [
                {
                    url: resolveTelegramWebhookUrl(
                        bot.app.getDecorator<Env>("config"),
                        stored.telegramId,
                    ),
                    secret_token: telegramWebhookSecret(
                        process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN ?? "",
                        stored.telegramId,
                    ),
                },
            ],
        );
        assert.deepEqual(invite.grants, [adminGrant]);
        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes(
                    `https://t.me/child_42_bot?start=invite_${String(invite.token)}`,
                ),
        );
        assert.ok(!JSON.stringify(logs.readEntries()).includes(childToken));
    });

    void it("makes the owner an admin of the new bot only, and keeps update ids of the bots apart", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657002 });
        const owner = buildTelegramPrivateChat({ id: 987657003 });
        const actor = await allowAdmin(bot, admin);
        const result = await bot.botsService.add(actor, childToken);

        assert.equal(result.status, "added");

        nextUpdateId += 1;

        const updateId = nextUpdateId;
        const childId = result.bot._id;

        await sendTo(
            bot,
            childId,
            owner,
            `/start invite_${result.ownerInvite.token}`,
            updateId,
        );
        await sendTo(bot, testBotId, owner, "/start", updateId);

        const childOwner = await bot.usersRepository.findOneByTelegramId(
            childId,
            String(owner.id),
        );
        const rootOwner = await bot.usersRepository.findOneByTelegramId(
            testBotId,
            String(owner.id),
        );

        assert.equal(childOwner?.isBanned, false);
        assert.deepEqual(childOwner.grants, [adminGrant]);
        assert.deepEqual(rootOwner?.grants, []);
        assert.ok(
            bot.childApis
                .get("42")
                ?.sendMessage.mock.calls.some(
                    ({ arguments: [args] }) => args.chat_id === owner.id,
                ),
        );
    });

    void it("turns a module of a bot on and off", async (t) => {
        const bot = await buildBot(t, { plugins: [pingHandlersPlugin] });
        const admin = buildTelegramPrivateChat({ id: 987657004 });
        const actor = await allowAdmin(bot, admin);

        const childId = await addChild(bot, actor);

        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, childLabel);
        await bot.pressButton(admin, en.modulesButton);
        await bot.pressButton(admin, `⬜ ${pingLocales.en.section}`);

        assert.deepEqual(bot.botsRegistry.modulesOf(childId), ["ping"]);
        assert.ok(
            (await bot.readButtonLabels(admin.id)).includes(
                `✅ ${pingLocales.en.section}`,
            ),
        );

        await bot.pressButton(admin, `✅ ${pingLocales.en.section}`);

        assert.deepEqual(bot.botsRegistry.modulesOf(childId), []);
    });

    void it("picks what /start opens in one bot only, and forgets a module that is turned off", async (t) => {
        const bot = await buildBot(t, {
            plugins: [
                pingHandlersPlugin,
                pokerRoomsRepositoryPlugin,
                pokerRoomsServicePlugin,
                pokerHandlersPlugin,
            ],
        });
        const admin = buildTelegramPrivateChat({ id: 987657021 });
        const player = buildTelegramPrivateChat({ id: 987657022 });
        const actor = await allowAdmin(bot, admin);
        const childId = await addChild(bot, actor);
        const pokerTitle = pokerLocales.en.section;

        await bot.botsService.toggleModule(actor, childId, "poker");
        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, childLabel);
        await bot.pressButton(admin, en.startModuleButton);

        assert.deepEqual(await bot.readButtonLabels(admin.id), [
            `⚪ ${pokerTitle}`,
            `🔘 ${en.startWelcomeButton}`,
            en.backButton,
        ]);

        await bot.pressButton(admin, `⚪ ${pokerTitle}`);

        assert.equal(bot.telegramBots.find(childId)?.startModule, "poker");
        assert.ok(
            (await bot.readButtonLabels(admin.id)).includes(`🔘 ${pokerTitle}`),
        );

        for (const botId of [childId, testBotId]) {
            await mongo.collection("users").insertOne(
                buildUserEntity({
                    botId,
                    telegramId: String(player.id),
                    grants: [pokerJoinGrant],
                }),
            );
            nextUpdateId += 1;
            await sendTo(bot, botId, player, "/start", nextUpdateId);
        }

        assert.ok(
            readTextsOf(bot.childApis.get("42"), player)
                .at(-1)
                ?.includes(pokerLocales.en.listEmpty),
        );
        assert.deepEqual(readTextsOf(bot.telegramApiService, player), [
            telegramLocales.en.welcome,
        ]);

        await bot.botsService.toggleModule(actor, childId, "poker");

        assert.equal(bot.telegramBots.find(childId)?.startModule, undefined);
        assert.equal(
            (await bot.botsService.setStartModule(actor, childId, "poker"))
                ?.startModule,
            undefined,
        );
    });

    void it("stops a bot after a second press, removes its webhook and serves it no more", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657005 });
        const actor = await allowAdmin(bot, admin);

        const childId = await addChild(bot, actor);

        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, childLabel);
        await bot.pressButton(admin, en.stopButton);

        assert.ok(bot.telegramBots.find(childId));

        await bot.pressButton(admin, en.confirmStopButton);

        assert.equal(bot.telegramBots.find(childId), undefined);
        assert.equal(
            bot.childApis.get("42")?.deleteWebhook.mock.callCount(),
            1,
        );
        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes(en.statusStopped),
        );
    });

    void it("offers no owner link for a stopped bot and redraws an open one as unavailable", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657007 });
        const actor = await allowAdmin(bot, admin);

        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, en.addButton);
        await bot.sendText(admin, childToken);

        const childId = await readChildId(bot);

        await bot.botsService.stop(actor, childId);
        await bot.telegramChats.idle();

        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes(en.ownerInviteUnavailable),
        );
        assert.equal(
            await bot.botsService.createOwnerInvite(actor, childId),
            null,
        );
        assert.equal(
            await mongo
                .collection("invites")
                .countDocuments({ botId: childId }),
            1,
        );

        await bot.pressButton(admin, en.backButton);
        await bot.pressButton(admin, childLabel);

        assert.ok(
            !(await bot.readButtonLabels(admin.id)).includes(
                en.ownerInviteButton,
            ),
        );
    });

    void it("shows the owner link without a request to Telegram", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657008 });
        const actor = await allowAdmin(bot, admin);

        const childId = await addChild(bot, actor);

        bot.childApis.get("42")?.getMe.mock.mockImplementation(async () => {
            throw new Error("connect ECONNREFUSED api.telegram.org");
        });
        await bot.cache.delete("telegram:42:username");
        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, childLabel);
        await bot.pressButton(admin, en.ownerInviteButton);

        const invite = await mongo
            .collection("invites")
            .findOne({ botId: childId }, { sort: { createdAt: -1 } });

        assert.ok(invite);
        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes(
                    `https://t.me/child_42_bot?start=invite_${String(invite.token)}`,
                ),
        );
    });

    void it("refuses a token that it can't store, one that Telegram rejects and one of another bot", async (t) => {
        const bot = await buildBot(t);
        const keyless = await buildBotsBot({ databaseName, mongoClient, t });
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

    void it("moves a bot to another Telegram bot after a second press and keeps its users and its id", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657009 });
        const owner = buildTelegramPrivateChat({ id: 987657010 });
        const actor = await allowAdmin(bot, admin);
        const result = await bot.botsService.add(actor, childToken);

        assert.equal(result.status, "added");

        const childId = result.bot._id;
        const link = { name: "invite", value: "token" };

        nextUpdateId += 1;
        await sendTo(
            bot,
            childId,
            owner,
            `/start invite_${result.ownerInvite.token}`,
            nextUpdateId,
        );

        assert.ok(
            (
                await bot.telegramBotService.resolveDeepLinkUrl(childId, link)
            ).includes("child_42_bot"),
        );

        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, childLabel);
        await bot.pressButton(admin, en.moveButton);
        await bot.pressButton(admin, en.confirmMoveButton);
        await bot.sendText(admin, otherToken);

        const moved = await bot.botsRepository.findOneById(childId);
        const user = await bot.usersRepository.findOneByTelegramId(
            childId,
            String(owner.id),
        );

        assert.equal(moved?.telegramId, "44");
        assert.equal(moved.username, "child_44_bot");
        assert.equal(bot.botsRegistry.find(childId)?.telegramId, "44");
        assert.deepEqual(user?.grants, [adminGrant]);
        assert.equal(
            bot.childApis.get("42")?.deleteWebhook.mock.callCount(),
            1,
        );
        assert.deepEqual(
            bot.childApis
                .get("44")
                ?.setWebhook.mock.calls.map(
                    ({ arguments: [args] }) => args.url,
                ),
            [
                resolveTelegramWebhookUrl(
                    bot.app.getDecorator<Env>("config"),
                    "44",
                ),
            ],
        );
        assert.ok((await bot.readMessageTexts(admin.id)).includes(en.botMoved));

        await sendTo(bot, childId, owner, "/start", nextUpdateId);

        assert.deepEqual(readTextsOf(bot.childApis.get("44"), owner), [
            telegramLocales.en.welcome,
        ]);
        assert.ok(
            (
                await bot.telegramBotService.resolveDeepLinkUrl(childId, link)
            ).includes("child_44_bot"),
        );
        assert.equal(await bot.telegramBots.loadByTelegramId("42"), undefined);
        assert.equal(
            (await bot.telegramBots.loadByTelegramId("44"))?.id,
            childId,
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
        await mongo.collection("bots").createIndex(
            { telegramId: 1 },
            {
                unique: true,
                name: "telegramId_unique",
                partialFilterExpression: { telegramId: { $exists: true } },
            },
        );
        t.after(() => mongo.collection("bots").dropIndex("telegramId_unique"));
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

    void it("keeps the bots away from the admin of any other bot", async (t) => {
        const bot = await buildBot(t);
        const access = bot.app
            .getDecorator<AccessService>("accessService")
            .subjects<BotsSubjects>();
        const adminOf = (botId: string) =>
            buildUserEntity({ botId, grants: [adminGrant] });

        assert.equal(access.can(adminOf(testBotId), "read", "Bot"), true);
        assert.equal(access.can(adminOf("42"), "read", "Bot"), false);
    });
});

function buildBot(
    t: TestContext,
    options: Partial<Parameters<typeof buildBotsBot>[0]> = {},
): Promise<BotsBot> {
    return buildBotsBot({
        databaseName,
        mongoClient,
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

async function readChildId(bot: BotsBot): Promise<string> {
    const child = await bot.botsRepository.findOneByTelegramId("42");

    assert.ok(child);

    return child._id;
}

async function allowAdmin(
    bot: BotsBot,
    chat: Chat.PrivateChat,
): Promise<UserEntity> {
    await bot.allowUser(chat.id);
    await mongo
        .collection("users")
        .updateOne(
            { botId: testBotId, telegramId: String(chat.id) },
            { $set: { grants: [adminGrant] } },
        );

    const user = await bot.usersRepository.findOneByTelegramId(
        testBotId,
        String(chat.id),
    );

    assert.ok(user);

    return user;
}

async function sendTo(
    bot: BotsBot,
    botId: string,
    chat: Chat.PrivateChat,
    text: string,
    updateId: number,
): Promise<void> {
    const [command = ""] = text.split(" ");

    await bot.telegramUpdateHandler.handle(
        bot.telegramBots.get(botId),
        buildTelegramTextMessageUpdate({
            update_id: updateId,
            message: {
                message_id: updateId,
                chat,
                from: buildTelegramUser({ id: chat.id }),
                text,
                entities: [
                    { type: "bot_command", offset: 0, length: command.length },
                ],
            },
        }),
    );
}

function readTextsOf(
    api: TelegramApiServiceMock | undefined,
    chat: Chat.PrivateChat,
): string[] {
    return (api?.sendMessage.mock.calls ?? [])
        .map(({ arguments: [args] }) => args)
        .filter(({ chat_id: chatId }) => chatId === chat.id)
        .map(({ text }) => text);
}

function readDeletedIds(bot: BotsBot): number[] {
    return [
        ...bot.telegramApiService.deleteMessage.mock.calls.map(
            ({ arguments: [args] }) => args.message_id,
        ),
        ...bot.telegramApiService.deleteMessages.mock.calls.flatMap(
            ({ arguments: [args] }) => args.message_ids,
        ),
    ];
}
