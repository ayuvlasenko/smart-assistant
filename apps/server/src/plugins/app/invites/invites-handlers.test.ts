import { Chat } from "@grammyjs/types";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import {
    after,
    before,
    beforeEach,
    describe,
    it,
    TestContext,
} from "node:test";
import { buildInvitesBot, InvitesBot } from "../../../test/invites-bot.js";
import { buildTestMongo } from "../../../test/mongo.js";
import {
    buildTelegramPrivateChat,
    buildTelegramTextMessageUpdate,
    buildTelegramUser,
} from "../../../test/telegram-fixtures.js";
import { adminGrant } from "../access/access-service.js";
import { pingGrant } from "../ping/ping-handlers.js";
import { telegramLocales } from "../telegram/telegram-locales.js";
import { InvitesSubjects } from "./invite-entity.js";
import { invitesLocales } from "./invites-locales.js";

let databaseName!: string;
let mongoClient!: MongoClient;
let mongo!: Db;
let strangerUpdateId = 100_000;

before(async () => {
    const testMongo = await buildTestMongo();

    databaseName = testMongo.databaseName;
    mongoClient = testMongo.client;
    mongo = testMongo.mongo;
});

beforeEach(async () => {
    await mongo.collection("users").deleteMany({});
    await mongo.collection("invites").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

const en = invitesLocales.en;

void describe("Invites bootstrap", () => {
    void it("makes the first user of INVITE_TOKEN an admin and closes the token", async (t) => {
        const bot = await buildBot(t, { INVITE_TOKEN: "bootstrap-token" });
        const first = buildTelegramPrivateChat({ id: 987654801 });
        const second = buildTelegramPrivateChat({ id: 987654802 });
        const third = buildTelegramPrivateChat({ id: 987654803 });

        await sendAsStranger(bot, first, "/start invite_bootstrap-token");
        await sendAsStranger(bot, second, "/start invite_bootstrap-token");
        await sendAsStranger(bot, third, "/start invite_wrong-token");

        const admin = await bot.usersRepository.findOneByTelegramId(
            String(first.id),
        );

        assert.equal(admin?.isBanned, false);
        assert.deepEqual(admin.grants, [adminGrant]);
        assert.equal(
            (await bot.usersRepository.findOneByTelegramId(String(second.id)))
                ?.isBanned,
            true,
        );
        assert.deepEqual(readSentTextsTo(bot, first), [
            telegramLocales.en.welcome,
        ]);
        assert.deepEqual(readSentTextsTo(bot, second), [en.inviteUnavailable]);
        assert.deepEqual(readSentTextsTo(bot, third), []);
        assert.deepEqual(readChatCommands(bot, first), [
            "cancel",
            "ping",
            "invites",
        ]);
    });
});

void describe("Invites scenes", () => {
    void it("keeps /invites away from a user without access", async (t) => {
        const bot = await buildBot(t);
        const chat = buildTelegramPrivateChat({ id: 987654811 });

        await bot.sendText(chat, "/invites");

        assert.deepEqual(bot.readSentTexts(), [telegramLocales.en.unknown]);
        assert.equal(
            bot.telegramApiService.sendRichMessage.mock.callCount(),
            0,
        );
    });

    void it("creates an invite with the chosen access, limit and expiry", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987654812 });

        await createAdmin(bot, admin);
        await createInviteThroughForm(bot, admin);

        const [invite] = await mongo.collection("invites").find().toArray();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;

        assert.ok(invite);
        assert.deepEqual(invite.grants, [pingGrant]);
        assert.equal(invite.maxUses, 3);
        assert.ok(
            Math.abs(
                (invite.expiresAt as Date).getTime() - Date.now() - sevenDays,
            ) < 60_000,
        );
        const messages = await bot.readMessageTexts(admin.id);

        assert.equal(messages.length, 1);
        assert.ok(messages[0]?.includes(en.inviteTitle));
        assert.match(
            readCopyTexts(bot).at(-1) ?? "",
            new RegExp(`\\?start=invite_${String(invite.token)}$`),
        );
        assert.ok(bot.readSentTexts().includes(en.limitPrompt));
    });

    void it("refuses to create an invite without access", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987654813 });

        await createAdmin(bot, admin);
        await bot.sendText(admin, "/invites");
        await bot.pressButton(admin, en.newInviteButton);
        await bot.pressButton(admin, en.createButton);

        assert.equal(await mongo.collection("invites").countDocuments(), 0);
        assert.equal(
            bot.telegramApiService.answerCallbackQuery.mock.calls.at(-1)
                ?.arguments[0].text,
            en.noAccessSelected,
        );
    });

    void it("lets a stranger in through the link and redraws the invite of the admin", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987654814 });
        const guest = buildTelegramPrivateChat({ id: 987654815 });
        const outsider = buildTelegramPrivateChat({ id: 987654816 });

        await createAdmin(bot, admin);
        await createInviteThroughForm(bot, admin);

        const token = await readInviteToken();

        await sendAsStranger(bot, guest, `/start invite_${token}`);
        await bot.telegramChats.idle();
        await bot.sendText(guest, "/ping");
        await bot.sendText(outsider, "/ping");

        assert.deepEqual(readSentTextsTo(bot, guest), [
            telegramLocales.en.welcome,
            "pong",
        ]);
        assert.deepEqual(readSentTextsTo(bot, outsider), [
            telegramLocales.en.unknown,
        ]);
        assert.ok(
            (await bot.readMessageTexts(admin.id)).at(-1)?.includes("1/3"),
        );

        await bot.pressButton(admin, "👥 Users (1)");

        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes("user @user"),
        );
    });

    void it("redraws the invite list of another admin and leaves other screens alone", async (t) => {
        const bot = await buildBot(t);
        const author = buildTelegramPrivateChat({ id: 987654824 });
        const watcher = buildTelegramPrivateChat({ id: 987654825 });
        const drafter = buildTelegramPrivateChat({ id: 987654826 });
        const guest = buildTelegramPrivateChat({ id: 987654827 });

        await createAdmin(bot, author);
        await createAdmin(bot, watcher);
        await createAdmin(bot, drafter);
        await createInviteThroughForm(bot, author);
        await bot.sendText(watcher, "/invites");
        await bot.sendText(drafter, "/invites");
        await bot.pressButton(drafter, en.newInviteButton);

        const draftEdits = countEditsIn(bot, drafter);

        await sendAsStranger(
            bot,
            guest,
            `/start invite_${await readInviteToken()}`,
        );
        await bot.telegramChats.idle();

        assert.ok(
            (await bot.readMessageTexts(author.id)).at(-1)?.includes("1/3"),
        );
        assert.ok(
            (await bot.readMessageTexts(watcher.id)).at(-1)?.includes("1/3"),
        );
        assert.equal(countEditsIn(bot, drafter), draftEdits);
    });

    void it("redraws the invite list of another admin when an invite is created or revoked", async (t) => {
        const bot = await buildBot(t);
        const author = buildTelegramPrivateChat({ id: 987654828 });
        const watcher = buildTelegramPrivateChat({ id: 987654829 });

        await createAdmin(bot, author);
        await createAdmin(bot, watcher);
        await bot.sendText(watcher, "/invites");
        await createInviteThroughForm(bot, author);
        await bot.telegramChats.idle();

        assert.ok(
            (await bot.readMessageTexts(watcher.id)).at(-1)?.includes("🟢 0/3"),
        );

        await bot.pressButton(author, en.revokeButton);
        await bot.pressButton(author, en.confirmRevokeButton);
        await bot.telegramChats.idle();

        assert.ok(
            (await bot.readMessageTexts(watcher.id)).at(-1)?.includes("⛔ 0/3"),
        );
    });

    void it("adds the access of an invite to a user who is already in", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987654817 });
        const member = buildTelegramPrivateChat({ id: 987654818 });

        await createAdmin(bot, admin);
        await createInviteThroughForm(bot, admin);
        await bot.sendText(member, `/start invite_${await readInviteToken()}`);
        await bot.sendText(member, "/ping");

        assert.deepEqual(readSentTextsTo(bot, member), [
            en.accessUpdated,
            "pong",
        ]);
        assert.deepEqual(readChatCommands(bot, member), ["cancel", "ping"]);
    });

    void it("revokes an invite after a confirmation", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987654819 });
        const guest = buildTelegramPrivateChat({ id: 987654820 });

        await createAdmin(bot, admin);
        await createInviteThroughForm(bot, admin);
        await bot.pressButton(admin, en.revokeButton);

        assert.equal(
            (await mongo.collection("invites").findOne())?.revokedAt,
            undefined,
        );

        await bot.pressButton(admin, en.confirmRevokeButton);
        await sendAsStranger(
            bot,
            guest,
            `/start invite_${await readInviteToken()}`,
        );

        assert.ok((await mongo.collection("invites").findOne())?.revokedAt);
        assert.deepEqual(readSentTextsTo(bot, guest), [en.inviteUnavailable]);
        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes(invitesLocales.en.statusRevoked),
        );
    });

    void it("hides the create and revoke buttons from a user who can only read invites", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987654822 });
        const reader = buildTelegramPrivateChat({ id: 987654823 });

        bot.accessService.subjects<InvitesSubjects>().register({
            name: "test",
            title: () => "Test",
            grants: [
                {
                    name: "test.reader",
                    title: () => "Reader",
                    define: ({ can }) => {
                        can("read", "Invite");
                    },
                },
            ],
        });

        await createAdmin(bot, admin);
        await createInviteThroughForm(bot, admin);
        await bot.allowUser(reader.id);
        await mongo
            .collection("users")
            .updateOne(
                { telegramId: String(reader.id) },
                { $set: { grants: ["test.reader"] } },
            );
        await bot.sendText(reader, "/invites");

        await assert.rejects(
            bot.pressButton(reader, en.newInviteButton),
            /Expected a/,
        );

        await bot.pressButton(reader, "#1 🟢 0/3");

        await assert.rejects(
            bot.pressButton(reader, en.revokeButton),
            /Expected a/,
        );
        await bot.pressButton(reader, en.refreshButton);
    });

    void it("navigates between the list and an invite in one message", async (t) => {
        const bot = await buildBot(t);
        const admin = buildTelegramPrivateChat({ id: 987654821 });

        await createAdmin(bot, admin);
        await createInviteThroughForm(bot, admin);
        await bot.pressButton(admin, en.backButton);

        const [list = "", ...rest] = await bot.readMessageTexts(admin.id);

        assert.ok(list.includes(en.listTitle));
        assert.ok(list.includes("0/3"));
        assert.deepEqual(rest, []);

        await bot.pressButton(admin, "#1 🟢 0/3");

        assert.ok(
            (await bot.readMessageTexts(admin.id))
                .at(-1)
                ?.includes(en.inviteTitle),
        );

        await bot.sendText(admin, "/invites");

        const messages = await bot.readMessageTexts(admin.id);

        assert.equal(messages.length, 1);
        assert.ok(messages[0]?.includes(en.inviteTitle));
    });
});

function buildBot(
    t: TestContext,
    env: Record<string, string> = {},
): Promise<InvitesBot> {
    return buildInvitesBot({ databaseName, mongoClient, t, env });
}

async function createAdmin(
    bot: InvitesBot,
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

async function createInviteThroughForm(
    bot: InvitesBot,
    admin: Chat.PrivateChat,
): Promise<void> {
    await bot.sendText(admin, "/invites");
    await bot.pressButton(admin, en.newInviteButton);
    await bot.pressButton(admin, "Access (0)");
    await bot.pressButton(admin, "Ping (0/1)");
    await bot.pressButton(admin, "⬜ Use /ping");
    await bot.pressButton(admin, en.backButton);
    await bot.pressButton(admin, en.backButton);
    await bot.pressButton(admin, "Users: 1");
    await bot.sendText(admin, "3");
    await bot.pressButton(admin, "Valid for: never");
    await bot.pressButton(admin, en.sevenDays);
    await bot.pressButton(admin, en.createButton);
}

async function readInviteToken(): Promise<string> {
    const invite = await mongo.collection("invites").findOne();

    assert.ok(invite);

    return String(invite.token);
}

async function sendAsStranger(
    bot: InvitesBot,
    chat: Chat.PrivateChat,
    text: string,
): Promise<void> {
    strangerUpdateId += 1;

    const [command] = text.split(" ");

    await bot.telegramUpdateHandler.handle(
        buildTelegramTextMessageUpdate({
            update_id: strangerUpdateId,
            message: {
                chat,
                from: buildTelegramUser({ id: chat.id }),
                text,
                entities: [
                    {
                        type: "bot_command",
                        offset: 0,
                        length: command?.length ?? 0,
                    },
                ],
            },
        }),
    );
}

function readSentTextsTo(bot: InvitesBot, chat: Chat.PrivateChat): string[] {
    return bot.telegramApiService.sendMessage.mock.calls
        .map((call) => call.arguments[0])
        .filter(({ chat_id: chatId }) => chatId === chat.id)
        .map(({ text }) => text);
}

function countEditsIn(bot: InvitesBot, chat: Chat.PrivateChat): number {
    return bot.telegramApiService.editMessageText.mock.calls.filter(
        (call) => call.arguments[0].chat_id === chat.id,
    ).length;
}

function readCopyTexts(bot: InvitesBot): string[] {
    const texts: string[] = [];

    const calls = [
        ...bot.telegramApiService.sendMessage.mock.calls,
        ...bot.telegramApiService.editMessageText.mock.calls,
    ];

    for (const call of calls) {
        const markup = call.arguments[0].reply_markup;

        if (!markup || !("inline_keyboard" in markup)) {
            continue;
        }

        for (const button of markup.inline_keyboard.flat()) {
            if ("copy_text" in button) {
                texts.push(button.copy_text.text);
            }
        }
    }

    return texts;
}

function readChatCommands(
    bot: InvitesBot,
    chat: Chat.PrivateChat,
): string[] | undefined {
    return bot.telegramApiService.setMyCommands.mock.calls
        .map((call) => call.arguments[0])
        .filter(
            ({ scope }) => scope?.type === "chat" && scope.chat_id === chat.id,
        )
        .at(-1)
        ?.commands.map(({ command }) => command);
}
