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
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramPrivateChat,
    buildTelegramTextMessageUpdate,
    buildTelegramUser,
    testTelegramBotId,
} from "../../../test/telegram-fixtures.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { AccessService, adminGrant } from "../access/access-service.js";
import pingHandlersPlugin from "../ping/ping-handlers.js";
import { pingLocales } from "../ping/ping-locales.js";
import { resolveTelegramWebhookUrl } from "../telegram/telegram-bot-service.js";
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
        const logs = createLogCollector();
        const bot = await buildBot(t, { logger: logs.logger });
        const admin = buildTelegramPrivateChat({ id: 987657001 });

        await allowAdmin(bot, admin);
        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, en.addButton);

        const answer = await bot.sendText(admin, childToken);
        const stored = await bot.botsRepository.findOneById("42");
        const childApi = bot.childApis.get("42");
        const invite = await mongo
            .collection("invites")
            .findOne({ botId: "42" });

        assert.ok(invite);

        assert.equal(stored?.username, "child_42_bot");
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
                        "42",
                    ),
                    secret_token: telegramWebhookSecret(
                        process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN ?? "",
                        "42",
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

        await sendTo(
            bot,
            "42",
            owner,
            `/start invite_${result.ownerInvite.token}`,
            updateId,
        );
        await sendTo(bot, testTelegramBotId, owner, "/start", updateId);

        const childOwner = await bot.usersRepository.findOneByTelegramId(
            "42",
            String(owner.id),
        );
        const rootOwner = await bot.usersRepository.findOneByTelegramId(
            testTelegramBotId,
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

        await bot.botsService.add(actor, childToken);
        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, childLabel);
        await bot.pressButton(admin, en.modulesButton);
        await bot.pressButton(admin, `⬜ ${pingLocales.en.section}`);

        assert.deepEqual(bot.botsRegistry.modulesOf("42"), ["ping"]);
        assert.ok(
            (await bot.readButtonLabels(admin.id)).includes(
                `✅ ${pingLocales.en.section}`,
            ),
        );

        await bot.pressButton(admin, `✅ ${pingLocales.en.section}`);

        assert.deepEqual(bot.botsRegistry.modulesOf("42"), []);
    });

    void it("stops a bot after a second press, removes its webhook and serves it no more", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657005 });
        const actor = await allowAdmin(bot, admin);

        await bot.botsService.add(actor, childToken);
        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, childLabel);
        await bot.pressButton(admin, en.stopButton);

        assert.ok(bot.telegramBots.find("42"));

        await bot.pressButton(admin, en.confirmStopButton);

        assert.equal(bot.telegramBots.find("42"), undefined);
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
        await bot.botsService.stop(actor, "42");
        await bot.telegramChats.idle();

        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes(en.ownerInviteUnavailable),
        );
        assert.equal(
            await bot.botsService.createOwnerInvite(actor, "42"),
            null,
        );
        assert.equal(
            await mongo.collection("invites").countDocuments({ botId: "42" }),
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

    void it("shows the owner link as unavailable when Telegram rejects the token of the bot", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987657008 });
        const actor = await allowAdmin(bot, admin);

        await bot.sendText(admin, "/bots");
        await bot.pressButton(admin, en.addButton);
        await bot.sendText(admin, childToken);
        bot.childApis.get("42")?.getMe.mock.mockImplementation(async () => ({
            ok: false,
            error_code: 401,
            description: "Unauthorized",
        }));
        await bot.cache.delete("telegram:42:username");
        await bot.botsService.reconnect(actor, "42");
        await bot.telegramChats.idle();

        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes(en.ownerInviteUnavailable),
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
        await bot.botsService.add(actor, childToken);
        assert.deepEqual(await bot.botsService.add(actor, childToken), {
            status: "alreadyAdded",
            botId: "42",
        });
        assert.deepEqual(
            await bot.botsService.replaceToken(
                actor,
                "42",
                "44:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
            ),
            { status: "otherBot" },
        );
    });

    void it("keeps the bots away from the admin of any other bot", async (t) => {
        const bot = await buildBot(t);
        const access = bot.app
            .getDecorator<AccessService>("accessService")
            .subjects<BotsSubjects>();
        const adminOf = (botId: string) =>
            buildUserEntity({ botId, grants: [adminGrant] });

        assert.equal(
            access.can(adminOf(testTelegramBotId), "read", "Bot"),
            true,
        );
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

async function allowAdmin(
    bot: BotsBot,
    chat: Chat.PrivateChat,
): Promise<UserEntity> {
    await bot.allowUser(chat.id);
    await mongo
        .collection("users")
        .updateOne(
            { botId: testTelegramBotId, telegramId: String(chat.id) },
            { $set: { grants: [adminGrant] } },
        );

    const user = await bot.usersRepository.findOneByTelegramId(
        testTelegramBotId,
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
