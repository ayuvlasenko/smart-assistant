import { ForbiddenError } from "@casl/ability";
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
import { UserEntity } from "../users/user-entity.js";
import { pokerCreateGrant, pokerJoinGrant } from "./poker-handlers.js";
import {
    PokerRoomEntity,
    pokerRoomIdleMilliseconds,
} from "./poker-room-entity.js";

let databaseName!: string;
let mongoClient!: MongoClient;
let mongo!: Db;
let nextTelegramId = 987655000;

before(async () => {
    const testMongo = await buildTestMongo();

    databaseName = testMongo.databaseName;
    mongoClient = testMongo.client;
    mongo = testMongo.mongo;
});

beforeEach(async () => {
    await mongo.collection("users").deleteMany({});
    await mongo.collection("pokerRooms").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

void describe("PokerRoomsService create and join", () => {
    void it("creates a room with the creator as its first participant", async (t) => {
        const bot = await buildBot(t);
        const creator = await createUser(bot, [pokerCreateGrant]);

        const room = await bot.pokerRoomsService.create(creator, {
            title: "Sprint 42",
            deck: "tShirt",
            autoReveal: true,
        });

        assert.match(room.token, /^[A-Za-z0-9_-]{22}$/);
        assert.equal(room.title, "Sprint 42");
        assert.equal(room.deck, "tShirt");
        assert.equal(room.autoReveal, true);
        assert.equal(room.participants.length, 1);
        assert.ok(room.participants[0]?.userId.equals(creator._id));
        assert.deepEqual(
            { ...room.round, startedAt: undefined },
            { number: 1, status: "voting", votes: {}, startedAt: undefined },
        );
    });

    void it("refuses to create a room for a user who can only join", async (t) => {
        const bot = await buildBot(t);
        const member = await createUser(bot, [pokerJoinGrant]);

        await assert.rejects(
            bot.pokerRoomsService.create(member, {
                deck: "fibonacci",
                autoReveal: false,
            }),
            ForbiddenError,
        );
    });

    void it("gives every participant a different emoji and joins a user once", async (t) => {
        const bot = await buildBot(t);
        const room = await createRoom(bot);
        const members = await Promise.all(
            Array.from({ length: 5 }, () => createUser(bot, [pokerJoinGrant])),
        );

        const results = await Promise.all(
            members.map((member) =>
                bot.pokerRoomsService.join(member, room.token),
            ),
        );
        const again = await bot.pokerRoomsService.join(members[0]!, room.token);
        const joined = await findRoom(room);
        const emojis = joined.participants.map(({ emoji }) => emoji);

        assert.deepEqual(
            results.map(({ status }) => status),
            ["joined", "joined", "joined", "joined", "joined"],
        );
        assert.equal(again.status, "alreadyJoined");
        assert.equal(joined.participants.length, 6);
        assert.equal(new Set(emojis).size, 6);
    });

    void it("refuses an unknown link, a closed room and a user without the grant", async (t) => {
        const bot = await buildBot(t);
        const room = await createRoom(bot);
        const member = await createUser(bot, [pokerJoinGrant]);
        const stranger = await createUser(bot, []);

        assert.deepEqual(await bot.pokerRoomsService.join(member, "missing"), {
            status: "notFound",
        });
        await assert.rejects(
            bot.pokerRoomsService.join(stranger, room.token),
            ForbiddenError,
        );

        await makeIdle(room);

        assert.deepEqual(await bot.pokerRoomsService.join(member, room.token), {
            status: "closed",
        });
    });
});

void describe("PokerRoomsService rounds", () => {
    void it("removes a vote when the same card is chosen again", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);

        const voted = await bot.pokerRoomsService.vote(creator, room, {
            round: 1,
            card: "5",
        });
        assert.ok(voted);
        const removed = await bot.pokerRoomsService.vote(creator, voted, {
            round: 1,
            card: "5",
        });

        assert.deepEqual(voted.round.votes, {
            [creator._id.toHexString()]: "5",
        });
        assert.deepEqual(removed?.round.votes, {});
    });

    void it("ignores a vote of a user outside the room", async (t) => {
        const bot = await buildBot(t);
        const room = await createRoom(bot);
        const outsider = await createUser(bot, [pokerJoinGrant]);

        assert.equal(
            await bot.pokerRoomsService.vote(outsider, room, {
                round: 1,
                card: "8",
            }),
            null,
        );
        assert.equal(
            await bot.pokerRoomsService.reveal(outsider, room, 1),
            null,
        );
        assert.deepEqual(await findRoom(room), room);
    });

    void it("ignores a vote after the reveal", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);

        await bot.pokerRoomsService.vote(creator, room, {
            round: 1,
            card: "3",
        });
        await bot.pokerRoomsService.reveal(creator, room, 1);

        assert.equal(
            await bot.pokerRoomsService.vote(creator, room, {
                round: 1,
                card: "8",
            }),
            null,
        );
        assert.deepEqual((await findRoom(room)).round.votes, {
            [creator._id.toHexString()]: "3",
        });
    });

    void it("ignores every action aimed at a round that is already over", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const revealed = await bot.pokerRoomsService.reveal(creator, room, 1);

        assert.ok(revealed);
        const next = await bot.pokerRoomsService.startRound(creator, revealed, {
            round: 1,
            repeat: false,
        });

        assert.ok(next);
        assert.equal(
            await bot.pokerRoomsService.renameRound(creator, next, {
                round: 1,
                title: "PROJ-1",
            }),
            null,
        );
        assert.equal(
            await bot.pokerRoomsService.vote(creator, next, {
                round: 1,
                card: "5",
            }),
            null,
        );
        assert.equal(
            await bot.pokerRoomsService.reveal(creator, next, 1),
            null,
        );
        assert.deepEqual(await findRoom(room), next);
    });

    void it("refuses a card that is not in the deck", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);

        await assert.rejects(
            bot.pokerRoomsService.vote(creator, room, { round: 1, card: "XL" }),
            /not in the deck/,
        );
    });

    void it("starts the next round once when two users press at the same time", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);

        await bot.pokerRoomsService.renameRound(creator, room, {
            round: 1,
            title: "PROJ-1",
        });
        await bot.pokerRoomsService.vote(creator, room, {
            round: 1,
            card: "5",
        });
        const revealed = await bot.pokerRoomsService.reveal(member, room, 1);

        assert.ok(revealed);
        const [first, second] = await Promise.all([
            bot.pokerRoomsService.startRound(creator, revealed, {
                round: 1,
                repeat: true,
            }),
            bot.pokerRoomsService.startRound(member, revealed, {
                round: 1,
                repeat: false,
            }),
        ]);
        const stored = await findRoom(room);
        const [moved] = stored.rounds;

        assert.equal([first, second].filter(Boolean).length, 1);
        assert.equal(stored.round.number, 2);
        assert.equal(stored.rounds.length, 1);
        assert.ok(moved);
        assert.equal(moved.title, "PROJ-1");
        assert.deepEqual(moved.votes, {
            [creator._id.toHexString()]: "5",
        });
    });

    void it("keeps the stored title on a revote and clears it for the next round", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const first = await bot.pokerRoomsService.reveal(creator, room, 1);

        assert.ok(first);
        await bot.pokerRoomsService.renameRound(creator, first, {
            round: 1,
            title: "PROJ-2",
        });
        const revote = await bot.pokerRoomsService.startRound(creator, first, {
            round: 1,
            repeat: true,
        });

        assert.ok(revote);
        const second = await bot.pokerRoomsService.reveal(creator, revote, 2);

        assert.ok(second);
        const next = await bot.pokerRoomsService.startRound(creator, second, {
            round: 2,
            repeat: false,
        });

        const [revoted] = revote.rounds;

        assert.equal(revote.round.title, "PROJ-2");
        assert.ok(revoted);
        assert.equal(revoted.title, "PROJ-2");
        assert.ok(next);
        assert.equal(next.round.number, 3);
        assert.equal("title" in next.round, false);
        assert.equal("revealedAt" in next.round, false);
    });

    void it("reveals the round by itself when every active participant votes", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot, {
            autoReveal: true,
        });
        const member = await joinMember(bot, room);

        const first = await bot.pokerRoomsService.vote(creator, room, {
            round: 1,
            card: "3",
        });

        assert.ok(first);
        const second = await bot.pokerRoomsService.vote(member, first, {
            round: 1,
            card: "5",
        });

        assert.equal(first.round.status, "voting");
        assert.equal(second?.round.status, "revealed");
    });

    void it("stops waiting for a participant who skipped two rounds", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot, {
            autoReveal: true,
        });
        let current = room;

        await joinMember(bot, room);

        for (const card of ["1", "2", "3"]) {
            const round = current.round.number;
            const voted = await bot.pokerRoomsService.vote(creator, current, {
                round,
                card,
            });

            assert.ok(voted);
            const revealed = await bot.pokerRoomsService.reveal(
                creator,
                voted,
                round,
            );

            assert.ok(revealed);
            const started = await bot.pokerRoomsService.startRound(
                creator,
                revealed,
                { round, repeat: false },
            );

            assert.ok(started);
            current = started;
        }

        const voted = await bot.pokerRoomsService.vote(creator, current, {
            round: current.round.number,
            card: "8",
        });

        assert.equal(voted?.round.status, "revealed");
    });
});

void describe("PokerRoomsService close", () => {
    void it("closes a room for its creator and stops every change in it", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);

        await assert.rejects(
            bot.pokerRoomsService.close(member, room),
            ForbiddenError,
        );

        const closed = await bot.pokerRoomsService.close(creator, room);

        assert.ok(closed?.closedAt);
        assert.equal(await bot.pokerRoomsService.close(creator, room), null);
        assert.equal(
            await bot.pokerRoomsService.vote(member, room, {
                round: 1,
                card: "5",
            }),
            null,
        );
        assert.deepEqual(
            await bot.pokerRoomsService.join(
                await createUser(bot, [pokerJoinGrant]),
                room.token,
            ),
            { status: "closed" },
        );

        const page = { skip: 0, limit: 10 };
        const open = await bot.pokerRoomsService.list(member, {
            status: "open",
            ...page,
        });
        const archived = await bot.pokerRoomsService.list(creator, {
            status: "closed",
            ...page,
        });

        assert.deepEqual(open.items, []);
        assert.deepEqual(
            archived.items.map(({ _id }) => _id.toHexString()),
            [room._id.toHexString()],
        );
    });
});

void describe("PokerRoomsService list", () => {
    void it("lists the open rooms of a participant and the closed rooms of their creator", async (t) => {
        const bot = await buildBot(t);
        const { room: open, creator } = await createRoomWithCreator(bot);
        const closed = await bot.pokerRoomsService.create(creator, {
            deck: "fibonacci",
            autoReveal: false,
        });
        const member = await joinMember(bot, open);
        const outsider = await createUser(bot, [pokerCreateGrant]);

        await joinMember(bot, closed, member);
        await makeIdle(closed);

        const page = { skip: 0, limit: 10 };
        const ids = async (user: UserEntity, status: "open" | "closed") =>
            (
                await bot.pokerRoomsService.list(user, { status, ...page })
            ).items.map(({ _id }) => _id.toHexString());

        assert.deepEqual(await ids(creator, "open"), [open._id.toHexString()]);
        assert.deepEqual(await ids(member, "open"), [open._id.toHexString()]);
        assert.deepEqual(await ids(outsider, "open"), []);
        assert.deepEqual(await ids(creator, "closed"), [
            closed._id.toHexString(),
        ]);
        assert.deepEqual(await ids(member, "closed"), []);
    });

    void it("finds a room only for its participants and its creator", async (t) => {
        const bot = await buildBot(t);
        const { room } = await createRoomWithCreator(bot);
        const outsider = await createUser(bot, [pokerJoinGrant]);
        const member = await joinMember(bot, room);

        assert.equal(
            await bot.pokerRoomsService.find(outsider, room._id),
            null,
        );
        assert.ok(await bot.pokerRoomsService.find(member, room._id));
    });
});

function buildBot(t: TestContext): Promise<PokerBot> {
    return buildPokerBot({ databaseName, mongoClient, t });
}

async function createUser(
    bot: PokerBot,
    grants: string[],
): Promise<UserEntity> {
    nextTelegramId += 1;

    const { user } = await bot.usersRepository.findOneByTelegramIdOrCreate({
        telegramId: String(nextTelegramId),
        isBanned: false,
        languageCode: "en",
    });

    await mongo
        .collection("users")
        .updateOne({ _id: user._id }, { $set: { grants } });

    return { ...user, grants };
}

async function createRoomWithCreator(
    bot: PokerBot,
    { autoReveal = false }: { autoReveal?: boolean } = {},
): Promise<{ room: PokerRoomEntity; creator: UserEntity }> {
    const creator = await createUser(bot, [pokerCreateGrant]);
    const room = await bot.pokerRoomsService.create(creator, {
        deck: "fibonacciModified",
        autoReveal,
    });

    return { room, creator };
}

async function createRoom(bot: PokerBot): Promise<PokerRoomEntity> {
    return (await createRoomWithCreator(bot)).room;
}

async function joinMember(
    bot: PokerBot,
    room: PokerRoomEntity,
    member?: UserEntity,
): Promise<UserEntity> {
    const user = member ?? (await createUser(bot, [pokerJoinGrant]));
    const result = await bot.pokerRoomsService.join(user, room.token);

    assert.equal(result.status, "joined");

    return user;
}

async function findRoom(room: PokerRoomEntity): Promise<PokerRoomEntity> {
    const stored = await mongo
        .collection<PokerRoomEntity>("pokerRooms")
        .findOne({ _id: room._id });

    assert.ok(stored);

    return stored;
}

async function makeIdle(room: PokerRoomEntity): Promise<void> {
    await mongo.collection<PokerRoomEntity>("pokerRooms").updateOne(
        { _id: room._id },
        {
            $set: {
                lastActivityAt: new Date(
                    Date.now() - pokerRoomIdleMilliseconds - 1000,
                ),
            },
        },
    );
}
