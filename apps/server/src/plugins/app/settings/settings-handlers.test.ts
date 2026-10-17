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
import { buildTestMongo } from "../../../test/mongo.js";
import { buildPokerBot, PokerBot } from "../../../test/poker-bot.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import { adminGrant } from "../access/access-service.js";
import { pokerLocales } from "../poker/poker-locales.js";
import { telegramLocales } from "../telegram/telegram-locales.js";
import { usersLocales } from "../users/users-locales.js";
import settingsHandlersPlugin from "./settings-handlers.js";
import { settingsLocales } from "./settings-locales.js";

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
    await mongo.collection("settings").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

const en = settingsLocales.en;

void describe("Settings menu", () => {
    void it("keeps /settings away from a user without the admin grant", async (t) => {
        const bot = await buildBot(t);
        const user = buildTelegramPrivateChat({ id: 987655301 });

        await bot.allowUser(user.id);
        await bot.sendText(user, "/settings");

        assert.deepEqual(bot.readSentTexts(), []);
    });

    void it("shows every setting with its value and switches a flag", async (t) => {
        const bot = await buildBot(t);
        const admin = await allowAdmin(bot, 987655302);

        await bot.sendText(admin, "/settings");

        const menu = await readMenu(bot, admin);

        assert.ok(menu.includes(`${usersLocales.en.autoBanSetting}: ${en.on}`));
        assert.ok(
            menu.includes(
                `${pokerLocales.en.maxParticipantsSetting}: 40 (2–100)`,
            ),
        );

        await bot.pressButton(admin, `🚫 ${usersLocales.en.autoBanSetting}`);

        assert.ok(
            (await readMenu(bot, admin)).includes(
                `${usersLocales.en.autoBanSetting}: ${en.off}`,
            ),
        );
    });

    void it("asks for a number again until it fits the range of the setting", async (t) => {
        const bot = await buildBot(t);
        const admin = await allowAdmin(bot, 987655303);

        await bot.sendText(admin, "/settings");
        await bot.pressButton(
            admin,
            `👥 ${pokerLocales.en.maxParticipantsSetting}`,
        );
        await bot.sendText(admin, "500");
        await bot.sendText(admin, "12");

        assert.ok(
            bot
                .readSentTexts()
                .includes(
                    telegramLocales.en.numberOutOfRange
                        .replace("{{min}}", "2")
                        .replace("{{max}}", "100"),
                ),
        );
        assert.ok(
            (await readMenu(bot, admin)).includes(
                `${pokerLocales.en.maxParticipantsSetting}: 12 (2–100)`,
            ),
        );
    });

    void it("chooses the default access of every user", async (t) => {
        const bot = await buildBot(t);
        const admin = await allowAdmin(bot, 987655304);
        const user = buildTelegramPrivateChat({ id: 987655305 });

        await bot.sendText(admin, "/settings");
        await bot.pressButton(admin, "🔑 Default access");

        assert.ok(!readEditedButtons(bot).includes("⬜ Full access"));
        assert.ok(
            readEditedButtons(bot).includes(
                `⬜ ${pokerLocales.en.createGrant}`,
            ),
        );

        await bot.pressButton(admin, `⬜ ${pokerLocales.en.createGrant}`);
        await bot.pressButton(admin, en.backButton);
        await bot.allowUser(user.id);
        await bot.sendText(user, "/poker");

        assert.ok(
            (await readMenu(bot, admin)).includes(
                `Default access: ${pokerLocales.en.createGrant}`,
            ),
        );
        assert.ok(
            bot
                .readLastKeyboard()
                .flat()
                .some(({ text }) => text === pokerLocales.en.newRoomButton),
        );
    });
});

function buildBot(t: TestContext): Promise<PokerBot> {
    return buildPokerBot({
        databaseName,
        mongoClient,
        t,
        plugins: [settingsHandlersPlugin],
    });
}

async function allowAdmin(
    bot: PokerBot,
    id: number,
): Promise<Chat.PrivateChat> {
    const chat = buildTelegramPrivateChat({ id });

    await bot.allowUser(id);
    await mongo
        .collection("users")
        .updateOne(
            { telegramId: String(id) },
            { $set: { grants: [adminGrant] } },
        );

    return chat;
}

async function readMenu(
    bot: PokerBot,
    chat: Chat.PrivateChat,
): Promise<string> {
    const menu = (await bot.readMessageTexts(chat.id)).find((text) =>
        text.startsWith(`${en.title}\n`),
    );

    assert.ok(menu);

    return menu;
}

function readEditedButtons(bot: PokerBot): string[] {
    const markup =
        bot.telegramApiService.editMessageText.mock.calls.at(-1)?.arguments[0]
            .reply_markup;

    return (markup?.inline_keyboard ?? []).flat().map(({ text }) => text);
}
