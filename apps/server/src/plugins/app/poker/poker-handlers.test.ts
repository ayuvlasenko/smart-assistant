import { Chat } from "@grammyjs/types";
import { Db, MongoClient, ObjectId } from "mongodb";
import assert from "node:assert/strict";
import {
    after,
    before,
    beforeEach,
    describe,
    it,
    TestContext,
} from "node:test";
import { Env } from "../../../env.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildPokerBot, PokerBot } from "../../../test/poker-bot.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { adminGrant } from "../access/access-service.js";
import {
    measureTelegramHtml,
    telegramMessageTextLimit,
} from "../telegram/telegram-html.js";
import { formatPokerRoomTime } from "./poker-format.js";
import { pokerCreateGrant, pokerJoinGrant } from "./poker-handlers.js";
import { pokerLocales } from "./poker-locales.js";
import { PokerRoomEntity, PokerRound } from "./poker-room-entity.js";
import { pokerMaxParticipantsSetting } from "./poker-rooms-service.js";

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
    await mongo.collection("pokerRooms").deleteMany({});
    await mongo.collection("settings").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

const en = pokerLocales.en;

interface KeyboardButton {
    text: string;
    style?: string;
    copy_text?: { text: string };
}

void describe("Poker access", () => {
    void it("keeps /poker and room links away from a user without a poker grant", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655101 });
        const stranger = buildTelegramPrivateChat({ id: 987655102 });

        await createRoomThroughForm(bot, creator);
        await bot.allowUser(stranger.id);
        await bot.sendText(stranger, "/poker");
        await bot.sendText(stranger, `/start poker_${await readToken()}`);

        assert.deepEqual(await bot.readMessageTexts(stranger.id), []);
        assert.equal((await readRoom()).participants.length, 1);
    });

    void it("refuses a new participant when the room reached the limit of the settings", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655104 });
        const member = buildTelegramPrivateChat({ id: 987655105 });
        const latecomer = buildTelegramPrivateChat({ id: 987655106 });

        await bot.settingsService.write(
            buildUserEntity({ grants: [adminGrant] }),
            pokerMaxParticipantsSetting,
            2,
        );
        await createRoomThroughForm(bot, creator);
        await joinRoom(bot, member);
        await joinRoom(bot, latecomer);

        assert.equal((await readRoom()).participants.length, 2);
        assert.ok(bot.readSentTexts().includes(en.roomFull));
    });

    void it("answers an unknown room link", async (t) => {
        const bot = await buildBot(t);
        const member = buildTelegramPrivateChat({ id: 987655103 });

        await allowWith(bot, member, [pokerJoinGrant]);
        await bot.sendText(member, "/start poker_missing");

        assert.deepEqual(bot.readSentTexts(), [en.roomNotFound]);
    });
});

void describe("Poker rooms", () => {
    void it("creates a room through the form and shows it below the list", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655111 });

        await createRoomThroughForm(bot, creator, {
            title: "Sprint 42",
            deck: en.deckTShirt,
        });

        const room = await readRoom();
        const [list, roomMessage, ...rest] = await bot.readMessageTexts(
            creator.id,
        );

        assert.equal(room.title, "Sprint 42");
        assert.equal(room.deck, "tShirt");
        assert.ok(list?.startsWith(en.listTitle));
        assert.ok(roomMessage);
        assert.ok(roomMessage.startsWith("Sprint 42 · Round 1 · voting"));
        assert.ok(
            (await readCallbackTexts(bot, creator)).includes(revealLabel(0, 1)),
        );
        assert.deepEqual(rest, []);
        assert.deepEqual(await readCardRows(bot, creator), [
            ["XS", "S", "M", "L", "XL", "XXL"],
        ]);
        assert.deepEqual(
            (await readRoomKeyboard(bot, creator))
                .slice(1)
                .map((row) => row.map(({ text }) => text)),
            [[revealLabel(0, 1)], [en.copyLinkButton, en.moreButton]],
        );
        assert.match(
            (await readRoomKeyboard(bot, creator)).at(-1)?.[0]?.copy_text
                ?.text ?? "",
            new RegExp(
                `^https://t\\.me/\\w+\\?start=poker_${await readToken()}$`,
            ),
        );
    });

    void it("returns to the page of the room list after the form", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655185 });

        await createRoomThroughForm(bot, creator);

        const room = await readRoom();

        await mongo.collection<PokerRoomEntity>("pokerRooms").insertMany(
            Array.from({ length: 5 }, (_, index) => ({
                ...room,
                _id: new ObjectId(),
                token: `${room.token}${index}`,
            })),
        );
        await bot.sendText(creator, "/poker");
        await bot.pressButton(creator, "›");
        await bot.pressButton(creator, en.newRoomButton);
        await bot.pressButton(creator, en.backButton);

        assert.ok(
            (await bot.readButtonLabels(creator.id)).some((label) =>
                label.startsWith("#6 "),
            ),
        );
    });

    void it("shows the votes of other participants without their cards", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655121 });
        const member = buildTelegramPrivateChat({ id: 987655122 });

        await createRoomThroughForm(bot, creator);
        await joinRoom(bot, member);
        await bot.pressButton(member, "13");
        await bot.telegramChats.idle();

        const creatorRoom = await readRoomMessage(bot, creator);

        assert.deepEqual(await readCardRows(bot, creator), [
            ["1", "2", "3", "5", "8", "13"],
        ]);
        const memberRoom = await readRoomMessage(bot, member);

        assert.ok(
            (await readCallbackTexts(bot, creator)).includes(revealLabel(1, 2)),
        );
        assert.match(creatorRoom, / ⏳$/m);
        assert.match(creatorRoom, / ✅$/m);
        assert.ok(!creatorRoom.includes("13"));
        assert.match(memberRoom, /\(you\) ✅$/m);
        assert.equal(
            (await readRoomKeyboard(bot, member))
                .flat()
                .find(({ text }) => text === "13")?.style,
            "primary",
        );

        await bot.pressButton(member, "13");
        await bot.telegramChats.idle();

        assert.ok(
            (await readCallbackTexts(bot, creator)).includes(revealLabel(0, 2)),
        );
        assert.deepEqual(
            (await readRoomKeyboard(bot, member))
                .flat()
                .filter(({ style }) => style === "primary")
                .map(({ text }) => text),
            [],
        );
    });

    void it("counts the changes of a room and its size after a join", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655123 });
        const member = buildTelegramPrivateChat({ id: 987655124 });

        await createRoomThroughForm(bot, creator);
        await joinRoom(bot, member);
        await bot.pressButton(member, "13");
        await bot.telegramChats.idle();

        const output = await bot.metrics.metrics();

        for (const change of ["created", "joined", "voted"]) {
            assert.match(
                output,
                new RegExp(
                    `^poker_room_changes_total\\{change="${change}"\\} 1$`,
                    "m",
                ),
            );
        }

        assert.match(output, /^poker_room_participants_sum 2$/m);
        assert.match(
            output,
            /^telegram_delivery_duration_seconds_count\{kind="publish"\} [1-9]\d*$/m,
        );
    });

    void it("lets any participant reveal the cards and start the next round", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655131 });
        const member = buildTelegramPrivateChat({ id: 987655132 });

        await createRoomThroughForm(bot, creator);
        await joinRoom(bot, member);
        await bot.pressButton(creator, en.moreButton);
        await bot.pressButton(creator, en.roundTitleButton);
        await bot.sendText(creator, "PROJ-123");
        await bot.pressButton(creator, "2");
        await bot.pressButton(member, "13");
        assert.equal(
            (await readRoomKeyboard(bot, member))
                .flat()
                .find(({ text }) => text === revealLabel(2, 2))?.style,
            "success",
        );
        await bot.pressButton(member, revealLabel(2, 2));
        await bot.telegramChats.idle();

        const revealed = await readRoomMessage(bot, creator);

        assert.ok(revealed.includes("Round 1 · revealed\nPROJ-123"));
        assert.ok(revealed.includes("⚠️ Big spread. Discuss:"));
        assert.match(revealed, /^2 — /m);
        assert.match(revealed, /^13 — /m);
        assert.ok(revealed.includes("Range 2–13"));

        await bot.pressButton(creator, en.revoteButton);
        await bot.telegramChats.idle();

        assert.ok(
            (await readRoomMessage(bot, member)).includes(
                "Round 2 · voting\nPROJ-123",
            ),
        );
    });

    void it("drops a round title that arrives after its round is over", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655171 });
        const member = buildTelegramPrivateChat({ id: 987655172 });

        await createRoomThroughForm(bot, creator);
        await joinRoom(bot, member);
        await bot.pressButton(creator, en.moreButton);
        await bot.pressButton(creator, en.roundTitleButton);
        await bot.pressButton(member, revealLabel(0, 2));
        await bot.pressButton(member, en.nextRoundButton);
        await bot.sendText(creator, "PROJ-7");
        await bot.telegramChats.idle();

        const room = await readRoom();

        assert.equal(room.round.number, 2);
        assert.equal(room.round.title, undefined);
        assert.equal(room.rounds[0]?.title, undefined);

        await bot.pressButton(creator, en.moreButton);
        await bot.pressButton(creator, en.roundTitleButton);
        await bot.sendText(creator, "PROJ-8");

        assert.equal((await readRoom()).round.title, "PROJ-8");
    });

    void it("reveals the cards by itself when the room has auto reveal", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655141 });
        const member = buildTelegramPrivateChat({ id: 987655142 });

        await createRoomThroughForm(bot, creator, { autoReveal: true });
        await joinRoom(bot, member);
        await bot.pressButton(creator, "5");
        await bot.telegramChats.idle();

        const voting = await readRoomMessage(bot, creator);

        assert.ok(!voting.includes("⚡"));
        assert.ok(
            (await readCallbackTexts(bot, creator)).includes(
                en.revealAutoButton
                    .replace("{{voted}}", "1")
                    .replace("{{total}}", "2"),
            ),
        );

        await bot.pressButton(member, "5");
        await bot.telegramChats.idle();

        const message = await readRoomMessage(bot, creator);

        assert.ok(message.includes("Round 1 · revealed"));
        assert.ok(message.includes(en.agreementUnanimous));
    });

    void it("shows the history of the revealed rounds", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655151 });

        await createRoomThroughForm(bot, creator);
        await bot.pressButton(creator, "8");
        await bot.pressButton(creator, revealLabel(1, 1));
        await bot.pressButton(creator, en.nextRoundButton);
        await bot.pressButton(creator, revealLabel(0, 1));
        await bot.pressButton(creator, en.nextRoundButton);
        await bot.pressButton(creator, en.moreButton);
        await bot.pressButton(creator, en.historyButton);

        const history = await readRoomMessage(bot, creator);

        assert.ok(history.includes(en.historyTitle));
        assert.ok(history.includes("#1 🎯 Median 8\n8 — "));
        assert.ok(!history.includes("#2"));
        assert.ok(!history.includes(en.agreementNone));
        assert.ok(
            !bot.telegramApiService.editMessageText.mock.calls.some((call) =>
                (call.arguments[0] as { text?: string }).text?.includes(
                    "<blockquote",
                ),
            ),
        );

        await bot.pressButton(creator, en.backButton);

        assert.ok(
            (await readRoomMessage(bot, creator)).includes("Round 3 · voting"),
        );
        assert.ok(
            (await bot.readButtonLabels(creator.id)).includes(en.historyButton),
        );
    });

    void it("lets only the creator close the room after a confirmation", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655181 });
        const member = buildTelegramPrivateChat({ id: 987655182 });

        await createRoomThroughForm(bot, creator);
        await joinRoom(bot, member);

        const memberButtons = await readCallbackTexts(bot, member);

        assert.ok(memberButtons.includes(revealLabel(0, 2)));
        assert.ok(!memberButtons.includes(en.closeButton));

        await bot.pressButton(creator, en.moreButton);

        assert.deepEqual(
            (await readRoomKeyboard(bot, creator))
                .at(-1)
                ?.map(({ text, style }) => ({ text, style })),
            [
                { text: en.backButton, style: undefined },
                { text: en.closeButton, style: "danger" },
            ],
        );

        await bot.pressButton(creator, en.closeButton);
        await bot.pressButton(creator, en.historyButton);
        await bot.pressButton(creator, en.backButton);
        await bot.pressButton(creator, en.closeButton);

        assert.equal((await readRoom()).closedAt, undefined);
        assert.ok(
            (await bot.readButtonLabels(creator.id)).includes(
                en.confirmCloseButton,
            ),
        );

        await bot.pressButton(creator, en.confirmCloseButton);
        await bot.telegramChats.idle();

        assert.ok((await readRoom()).closedAt);
        assert.ok((await readRoomMessage(bot, member)).includes(en.closedNote));
        assert.ok(!(await readCallbackTexts(bot, member)).includes("5"));

        await bot.pressButton(member, en.hideButton);

        assert.deepEqual(await bot.readMessageTexts(member.id), []);
    });

    void it("redraws the room list when a room closes", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655191 });
        await createRoomThroughForm(bot, creator);

        const roomButton = `#1 ${await readRoomTime(bot)} · 👥 1 · round 1`;

        const listButtons = (await readListKeyboard(bot, creator)).flat();

        assert.ok(listButtons.some(({ text }) => text === roomButton));

        await bot.pressButton(creator, en.moreButton);
        await bot.pressButton(creator, en.closeButton);
        await bot.pressButton(creator, en.confirmCloseButton);
        await bot.telegramChats.idle();

        assert.ok(
            !(await readListKeyboard(bot, creator))
                .flat()
                .some(({ text }) => text === roomButton),
        );
    });

    void it("puts only the rounds that fit into one history message on a page", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655152 });

        await createRoomThroughForm(bot, creator);
        await seedHistory(30, 5);
        await bot.pressButton(creator, en.moreButton);
        await bot.pressButton(creator, en.historyButton);

        const firstPage = await readRoomMessage(bot, creator);

        assert.ok(measureTelegramHtml(firstPage) <= telegramMessageTextLimit);
        assert.ok(firstPage.includes("#5"));
        assert.ok(firstPage.includes("#4"));
        assert.ok(!firstPage.includes("#3"));
        assert.ok((await readCallbackTexts(bot, creator)).includes("1/3"));

        await bot.pressButton(creator, "›");

        const secondPage = await readRoomMessage(bot, creator);

        assert.ok(secondPage.includes("#3"));
        assert.ok(secondPage.includes("#2"));
    });

    void it("shows a closed room to its creator as history only", async (t) => {
        const bot = await buildBot(t);
        const creator = buildTelegramPrivateChat({ id: 987655161 });

        await createRoomThroughForm(bot, creator);
        await mongo
            .collection("pokerRooms")
            .updateMany({}, { $set: { lastActivityAt: new Date(0) } });
        await bot.sendText(creator, "/poker");
        await bot.pressButton(creator, en.closedButton);
        await bot.pressButton(
            creator,
            `#1 ${await readRoomTime(bot)} · 👥 1 · round 1`,
        );

        const message = await readRoomMessage(bot, creator);

        assert.ok(message.includes(en.closedNote));
        assert.ok(!(await readCallbackTexts(bot, creator)).includes("5"));
    });
});

function buildBot(t: TestContext): Promise<PokerBot> {
    return buildPokerBot({ databaseName, mongoClient, t });
}

async function allowWith(
    bot: PokerBot,
    chat: Chat.PrivateChat,
    grants: string[],
): Promise<void> {
    await bot.allowUser(chat.id);
    await mongo
        .collection("users")
        .updateOne({ telegramId: String(chat.id) }, { $set: { grants } });
}

async function createRoomThroughForm(
    bot: PokerBot,
    creator: Chat.PrivateChat,
    {
        title,
        deck,
        autoReveal = false,
    }: { title?: string; deck?: string; autoReveal?: boolean } = {},
): Promise<void> {
    await allowWith(bot, creator, [pokerCreateGrant]);
    await bot.sendText(creator, "/poker");
    await bot.pressButton(creator, en.newRoomButton);

    if (deck) {
        await bot.pressButton(creator, en.deckButton);
        await bot.pressButton(creator, deck);
    }

    if (title) {
        await bot.pressButton(creator, en.titleButton);
        await bot.sendText(creator, title);
    }

    if (!autoReveal) {
        await bot.pressButton(creator, en.autoRevealButton);
    }

    await bot.pressButton(creator, en.createButton);
}

async function joinRoom(
    bot: PokerBot,
    member: Chat.PrivateChat,
): Promise<void> {
    await allowWith(bot, member, [pokerJoinGrant]);
    await bot.sendText(member, `/start poker_${await readToken()}`);
}

async function readRoom(): Promise<PokerRoomEntity> {
    const room = await mongo
        .collection<PokerRoomEntity>("pokerRooms")
        .findOne();

    assert.ok(room);

    return room;
}

async function seedHistory(voters: number, rounds: number): Promise<void> {
    const room = await readRoom();
    const users = Array.from({ length: voters }, (_, index) => ({
        _id: new ObjectId(),
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        telegramId: String(987656000 + index),
        isBanned: false,
        grants: [pokerJoinGrant],
        languageCode: "en",
        firstName: "Bartholomew Longname",
        username: `participant_with_long_name_${String(index).padStart(3, "0")}`,
    }));
    const cards = ["1", "2", "3", "5", "8", "13"];
    const votes = Object.fromEntries(
        users.map((user, index) => [
            user._id.toHexString(),
            cards[index % cards.length] ?? "1",
        ]),
    );
    const history: PokerRound[] = Array.from(
        { length: rounds },
        (_, index) => ({
            number: index + 1,
            status: "revealed",
            votes,
            startedAt: room.createdAt,
            revealedAt: room.createdAt,
        }),
    );

    await mongo.collection("users").insertMany(users);
    await mongo.collection<PokerRoomEntity>("pokerRooms").updateOne(
        { _id: room._id },
        {
            $push: {
                participants: {
                    $each: users.map((user, index) => ({
                        userId: user._id,
                        emoji: `${index}`,
                        joinedAt: room.createdAt,
                    })),
                },
            },
            $set: {
                rounds: history,
                round: {
                    number: rounds + 1,
                    status: "voting",
                    votes: {},
                    startedAt: room.createdAt,
                },
            },
        },
    );
}

async function readToken(): Promise<string> {
    return (await readRoom()).token;
}

async function readRoomMessage(
    bot: PokerBot,
    chat: Chat.PrivateChat,
): Promise<string> {
    const message = (await bot.readMessageTexts(chat.id)).at(-1);

    assert.ok(message);

    return message;
}

async function readCardRows(
    bot: PokerBot,
    chat: Chat.PrivateChat,
): Promise<string[][]> {
    return (await readRoomKeyboard(bot, chat))
        .filter((row) =>
            row.every(({ text }) => text.length <= 6 && !text.startsWith("⋯")),
        )
        .map((row) => row.map(({ text }) => text));
}

async function readCallbackTexts(
    bot: PokerBot,
    chat: Chat.PrivateChat,
): Promise<string[]> {
    return (await readRoomKeyboard(bot, chat)).flat().map(({ text }) => text);
}

async function readRoomKeyboard(
    bot: PokerBot,
    chat: Chat.PrivateChat,
): Promise<KeyboardButton[][]> {
    return (await readKeyboards(bot, chat)).at(-1) ?? [];
}

async function readListKeyboard(
    bot: PokerBot,
    chat: Chat.PrivateChat,
): Promise<KeyboardButton[][]> {
    return (await readKeyboards(bot, chat)).at(0) ?? [];
}

async function readKeyboards(
    bot: PokerBot,
    chat: Chat.PrivateChat,
): Promise<KeyboardButton[][][]> {
    const keyboards = new Map<number, unknown>();

    for (const call of bot.telegramApiService.sendMessage.mock.calls) {
        const response = await call.result;

        if (
            response?.ok &&
            call.arguments[0].chat_id === chat.id &&
            call.arguments[0].reply_markup
        ) {
            keyboards.set(
                response.result.message_id,
                call.arguments[0].reply_markup,
            );
        }
    }

    for (const call of bot.telegramApiService.editMessageText.mock.calls) {
        const args = call.arguments[0];

        if (
            args.chat_id === chat.id &&
            args.message_id !== undefined &&
            keyboards.has(args.message_id)
        ) {
            keyboards.set(args.message_id, args.reply_markup);
        }
    }

    return [...keyboards.entries()]
        .sort(([left], [right]) => left - right)
        .map(
            ([, markup]) =>
                (markup as { inline_keyboard?: KeyboardButton[][] } | undefined)
                    ?.inline_keyboard ?? [],
        );
}

function revealLabel(voted: number, total: number): string {
    return en.revealButton
        .replace("{{voted}}", String(voted))
        .replace("{{total}}", String(total));
}

async function readRoomTime(bot: PokerBot): Promise<string> {
    return formatPokerRoomTime(
        (await readRoom()).createdAt,
        bot.app.getDecorator<Env>("config").TIME_ZONE,
    );
}
