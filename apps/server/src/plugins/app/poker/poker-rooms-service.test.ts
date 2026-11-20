import { ForbiddenError } from "@casl/ability";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { useTestMongo } from "../../../test/mongo.js";
import { buildPokerBot, PokerBot } from "../../../test/poker-bot.js";
import { testBotId } from "../../../test/telegram-fixtures.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { adminGrant } from "../access/access-service.js";
import { UserEntity } from "../users/user-entity.js";
import { pokerCreateGrant, pokerJoinGrant } from "./poker-handlers.js";
import {
    PokerRoomEntity,
    pokerRoomIdleMilliseconds,
} from "./poker-room-entity.js";
import {
    pokerMaxParticipantsSetting,
    PokerRoomDraft,
} from "./poker-rooms-service.js";

const testMongo = useTestMongo();
let nextTelegramId = 987655000;

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
        assert.deepEqual(room.autoReveal, { missingVotes: 0 });
        assert.equal(room.participants.length, 1);
        assert.ok(room.participants[0]?.userId.equals(creator._id));
        assert.deepEqual(
            { ...room.round, startedAt: undefined },
            { number: 1, status: "voting", votes: {}, startedAt: undefined },
        );
    });

    void it("trims the title of a room and refuses one over the limit", async (t) => {
        const bot = await buildBot(t);
        const creator = await createUser(bot, [pokerCreateGrant]);

        const room = await bot.pokerRoomsService.create(creator, {
            title: "  Sprint 43  ",
            deck: "fibonacci",
            autoReveal: false,
        });

        assert.equal(room.title, "Sprint 43");
        await assert.rejects(
            bot.pokerRoomsService.create(creator, {
                title: "x".repeat(65),
                deck: "fibonacci",
                autoReveal: false,
            }),
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

    void it("fills the last place once when several users join at the same time", async (t) => {
        const bot = await buildBot(t);
        const room = await createRoom(bot);
        const users = await Promise.all(
            Array.from({ length: 4 }, () => createUser(bot, [pokerJoinGrant])),
        );

        await bot.settingsService.write(
            buildUserEntity({ grants: [adminGrant] }),
            pokerMaxParticipantsSetting,
            2,
        );

        const results = await Promise.all(
            users.map((user) => bot.pokerRoomsService.join(user, room.token)),
        );

        assert.deepEqual(
            results
                .map(({ status }) => status)
                .sort((left, right) => left.localeCompare(right)),
            ["full", "full", "full", "joined"],
        );
        assert.equal((await findRoom(room)).participants.length, 2);
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

    void it("doesn't find a room of another bot, also for its admin", async (t) => {
        const bot = await buildBot(t);
        const { room } = await createRoomWithCreator(bot);
        const admin = await createUser(bot, [adminGrant], "42");

        assert.deepEqual(await bot.pokerRoomsService.join(admin, room.token), {
            status: "notFound",
        });
        assert.equal(await bot.pokerRoomsService.find(admin, room._id), null);
    });

    void it("shows a room to an admin of its bot only while a participant", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const admin = await createUser(bot, [adminGrant]);

        assert.equal(await bot.pokerRoomsService.find(admin, room._id), null);
        assert.equal(
            await bot.pokerRoomsService.vote(admin, room._id, {
                round: 1,
                card: "5",
            }),
            null,
        );

        await joinMember(bot, room, admin);
        await bot.pokerRoomsService.removeParticipant(
            creator,
            room._id,
            admin._id,
        );

        assert.equal(await bot.pokerRoomsService.find(admin, room._id), null);
        assert.equal(
            await bot.pokerRoomsService.isRemoved(admin, room._id),
            true,
        );
    });
});

void describe("PokerRoomsService rounds", () => {
    void it("ignores a vote of a user outside the room", async (t) => {
        const bot = await buildBot(t);
        const room = await createRoom(bot);
        const outsider = await createUser(bot, [pokerJoinGrant]);

        assert.equal(
            await bot.pokerRoomsService.vote(outsider, room._id, {
                round: 1,
                card: "8",
            }),
            null,
        );
        assert.equal(
            await bot.pokerRoomsService.reveal(outsider, room._id, 1),
            null,
        );
        assert.deepEqual(await findRoom(room), room);
    });

    void it("ignores every action aimed at a round that is already over", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const revealed = await bot.pokerRoomsService.reveal(
            creator,
            room._id,
            1,
        );

        assert.ok(revealed);
        const next = await bot.pokerRoomsService.startRound(
            creator,
            revealed._id,
            {
                round: 1,
                repeat: false,
            },
        );

        assert.ok(next);
        assert.equal(
            await bot.pokerRoomsService.renameRound(creator, next._id, {
                round: 1,
                title: "PROJ-1",
            }),
            null,
        );
        assert.equal(
            await bot.pokerRoomsService.vote(creator, next._id, {
                round: 1,
                card: "5",
            }),
            null,
        );
        assert.equal(
            await bot.pokerRoomsService.reveal(creator, next._id, 1),
            null,
        );
        assert.deepEqual(await findRoom(room), next);
    });

    void it("starts the next round once when two users press at the same time", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);

        await bot.pokerRoomsService.renameRound(creator, room._id, {
            round: 1,
            title: "PROJ-1",
        });
        await bot.pokerRoomsService.vote(creator, room._id, {
            round: 1,
            card: "5",
        });
        const revealed = await bot.pokerRoomsService.reveal(
            member,
            room._id,
            1,
        );

        assert.ok(revealed);
        const [first, second] = await Promise.all([
            bot.pokerRoomsService.startRound(creator, revealed._id, {
                round: 1,
                repeat: true,
            }),
            bot.pokerRoomsService.startRound(member, revealed._id, {
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

    void it("reveals the round by itself when every active participant votes", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot, {
            autoReveal: true,
        });
        const member = await joinMember(bot, room);

        const first = await bot.pokerRoomsService.vote(creator, room._id, {
            round: 1,
            card: "3",
        });

        assert.ok(first);
        const second = await bot.pokerRoomsService.vote(member, first._id, {
            round: 1,
            card: "5",
        });

        assert.equal(first.round.status, "voting");
        assert.equal(second?.round.status, "revealed");
    });

    void it("records every vote and reveals once when all participants vote at the same time", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot, {
            autoReveal: true,
        });
        const members = [
            creator,
            await joinMember(bot, room),
            await joinMember(bot, room),
            await joinMember(bot, room),
            await joinMember(bot, room),
        ];
        const joined = await findRoom(room);

        await Promise.all(
            members.map((member) =>
                bot.pokerRoomsService.vote(member, joined._id, {
                    round: 1,
                    card: "5",
                }),
            ),
        );

        const voted = await findRoom(room);

        assert.equal(Object.keys(voted.round.votes).length, 5);
        assert.equal(voted.round.status, "revealed");
    });

    void it("applies a change to the room as it is stored after other changes", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);

        const voted = await bot.pokerRoomsService.vote(member, room._id, {
            round: 1,
            card: "5",
        });

        assert.ok(voted);
        await bot.pokerRoomsService.changeRole(creator, voted._id, {
            userId: member._id,
            role: "observer",
        });

        const changed = await bot.pokerRoomsService.changeAutoReveal(
            creator,
            voted._id,
            { missingVotes: 1 },
        );

        assert.ok(changed);
        assert.deepEqual(changed.autoReveal, { missingVotes: 1 });
        assert.equal(changed.round.status, "voting");
        assert.deepEqual(changed.round.votes, {});
        assert.equal(changed.participants[1]?.role, "observer");
    });

    void it("changes auto reveal only for a participant of an open room", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const outsider = await createUser(bot, [pokerJoinGrant]);

        assert.equal(
            await bot.pokerRoomsService.changeAutoReveal(outsider, room._id, {
                missingVotes: 1,
            }),
            null,
        );

        await bot.pokerRoomsService.close(creator, room._id);

        assert.equal(
            await bot.pokerRoomsService.changeAutoReveal(creator, room._id, {
                missingVotes: 0,
            }),
            null,
        );
        assert.equal((await findRoom(room)).autoReveal, null);
    });
});

void describe("PokerRoomsService roles", () => {
    void it("lets a participant make another one an observer and drops the vote of the open round", async (t) => {
        const bot = await buildBot(t);
        const { room } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);
        const another = await joinMember(bot, room);

        const voted = await bot.pokerRoomsService.vote(member, room._id, {
            round: 1,
            card: "5",
        });

        assert.ok(voted);
        const changed = await bot.pokerRoomsService.changeRole(
            another,
            voted._id,
            {
                userId: member._id,
                role: "observer",
            },
        );

        assert.ok(changed);
        assert.equal(
            changed.participants.find(({ userId }) => userId.equals(member._id))
                ?.role,
            "observer",
        );
        assert.deepEqual(changed.round.votes, {});
        assert.equal(
            await bot.pokerRoomsService.vote(member, changed._id, {
                round: 1,
                card: "8",
            }),
            null,
        );
    });

    void it("reveals the round by itself when the last voter without a vote starts watching", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot, {
            autoReveal: true,
        });
        const member = await joinMember(bot, room);

        const voted = await bot.pokerRoomsService.vote(creator, room._id, {
            round: 1,
            card: "3",
        });

        assert.ok(voted);
        const changed = await bot.pokerRoomsService.changeRole(
            creator,
            voted._id,
            {
                userId: member._id,
                role: "observer",
            },
        );

        assert.equal(voted.round.status, "voting");
        assert.equal(changed?.round.status, "revealed");
    });

    void it("changes a role only between participants of the room", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const outsider = await createUser(bot, [pokerJoinGrant]);

        assert.equal(
            await bot.pokerRoomsService.changeRole(outsider, room._id, {
                userId: creator._id,
                role: "observer",
            }),
            null,
        );
        assert.equal(
            await bot.pokerRoomsService.changeRole(creator, room._id, {
                userId: outsider._id,
                role: "observer",
            }),
            null,
        );
        assert.equal((await findRoom(room)).participants[0]?.role, "voter");
    });
});

void describe("PokerRoomsService participants", () => {
    void it("lets a participant remove another one and drops the vote of the open round", async (t) => {
        const bot = await buildBot(t);
        const { room } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);
        const another = await joinMember(bot, room);

        const voted = await bot.pokerRoomsService.vote(member, room._id, {
            round: 1,
            card: "5",
        });

        assert.ok(voted);
        const changed = await bot.pokerRoomsService.removeParticipant(
            another,
            voted._id,
            member._id,
        );

        assert.ok(changed);
        assert.equal(changed.participants.length, 2);
        assert.ok(changed.removedParticipants?.[0]?.userId.equals(member._id));
        assert.deepEqual(changed.round.votes, {});
        assert.equal(await bot.pokerRoomsService.find(member, room._id), null);
        assert.equal(
            await bot.pokerRoomsService.isRemoved(member, room._id),
            true,
        );
        assert.equal(
            await bot.pokerRoomsService.vote(member, changed._id, {
                round: 1,
                card: "8",
            }),
            null,
        );
    });

    void it("removes the creator like any other participant and refuses a user outside it", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);
        const outsider = await createUser(bot, [pokerJoinGrant]);

        assert.equal(
            await bot.pokerRoomsService.removeParticipant(
                outsider,
                room._id,
                member._id,
            ),
            null,
        );

        const changed = await bot.pokerRoomsService.removeParticipant(
            member,
            room._id,
            creator._id,
        );

        assert.ok(changed);
        assert.deepEqual(
            changed.participants.map(({ userId }) => userId.toHexString()),
            [member._id.toHexString()],
        );
        assert.equal(changed.closedAt, undefined);
        assert.equal(await bot.pokerRoomsService.find(creator, room._id), null);
        assert.equal(
            await bot.pokerRoomsService.isRemoved(creator, room._id),
            true,
        );
        assert.equal(
            await bot.pokerRoomsService.close(creator, room._id),
            null,
        );
    });

    void it("lets a participant leave and join again by the link", async (t) => {
        const bot = await buildBot(t);
        const { room } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);

        const left = await bot.pokerRoomsService.removeParticipant(
            member,
            room._id,
            member._id,
        );
        const again = await bot.pokerRoomsService.join(member, room.token);
        const joined = await findRoom(room);

        assert.equal(left?.participants.length, 1);
        assert.equal(again.status, "joined");
        assert.equal(joined.participants.length, 2);
        assert.deepEqual(joined.removedParticipants, []);
        assert.equal(
            await bot.pokerRoomsService.isRemoved(member, room._id),
            false,
        );
    });
});

void describe("PokerRoomsService close", () => {
    void it("lets any participant close a room and stops every change in it", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const member = await joinMember(bot, room);

        assert.equal(
            await bot.pokerRoomsService.close(
                await createUser(bot, [pokerCreateGrant]),
                room._id,
            ),
            null,
        );

        const closed = await bot.pokerRoomsService.close(member, room._id);

        assert.ok(closed?.closedAt);
        assert.equal(
            await bot.pokerRoomsService.close(creator, room._id),
            null,
        );
        assert.equal(
            await bot.pokerRoomsService.vote(member, room._id, {
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
        const archived = await bot.pokerRoomsService.list(member, {
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
    void it("lists the open and the closed rooms of a participant", async (t) => {
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
        assert.deepEqual(await ids(member, "closed"), [
            closed._id.toHexString(),
        ]);
        assert.deepEqual(await ids(outsider, "closed"), []);
    });

    void it("doesn't list a room of another bot, also for its admin", async (t) => {
        const bot = await buildBot(t);
        const room = await createRoom(bot);
        const neighbour = await createUser(bot, [pokerJoinGrant]);
        const stranger = await createUser(bot, [pokerJoinGrant], "42");
        const admin = await createUser(bot, [adminGrant], "42");

        await testMongo.mongo
            .collection<PokerRoomEntity>("pokerRooms")
            .updateOne(
                { _id: room._id },
                {
                    $push: {
                        participants: {
                            $each: [neighbour, stranger, admin].map(
                                ({ _id }) => ({
                                    userId: _id,
                                    emoji: "🐼",
                                    role: "voter" as const,
                                    joinedAt: new Date(),
                                }),
                            ),
                        },
                    },
                },
            );

        const page = { status: "open" as const, skip: 0, limit: 10 };
        const neighbourPage = await bot.pokerRoomsService.list(neighbour, page);

        assert.deepEqual(
            neighbourPage.items.map(({ _id }) => _id.toHexString()),
            [room._id.toHexString()],
        );
        assert.deepEqual(await bot.pokerRoomsService.list(stranger, page), {
            items: [],
            total: 0,
        });
        assert.deepEqual(await bot.pokerRoomsService.list(admin, page), {
            items: [],
            total: 0,
        });
    });

    void it("finds a room only for its participants", async (t) => {
        const bot = await buildBot(t);
        const { room, creator } = await createRoomWithCreator(bot);
        const outsider = await createUser(bot, [pokerJoinGrant]);
        const member = await joinMember(bot, room);

        assert.equal(
            await bot.pokerRoomsService.find(outsider, room._id),
            null,
        );
        assert.ok(await bot.pokerRoomsService.find(member, room._id));

        await bot.pokerRoomsService.removeParticipant(
            creator,
            room._id,
            creator._id,
        );

        assert.equal(await bot.pokerRoomsService.find(creator, room._id), null);
    });
});

function buildBot(t: TestContext): Promise<PokerBot> {
    return buildPokerBot({ testMongo, t });
}

async function createUser(
    bot: PokerBot,
    grants: string[],
    botId = testBotId,
): Promise<UserEntity> {
    nextTelegramId += 1;

    const { user } = await bot.usersRepository.findOneByTelegramIdOrCreate({
        botId,
        telegramId: String(nextTelegramId),
        isBanned: false,
        languageCode: "en",
    });

    await testMongo.mongo
        .collection("users")
        .updateOne({ _id: user._id }, { $set: { grants } });

    return { ...user, grants };
}

async function createRoomWithCreator(
    bot: PokerBot,
    { autoReveal = false }: Partial<Pick<PokerRoomDraft, "autoReveal">> = {},
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
    const stored = await testMongo.mongo
        .collection<PokerRoomEntity>("pokerRooms")
        .findOne({ _id: room._id });

    assert.ok(stored);

    return stored;
}

async function makeIdle(room: PokerRoomEntity): Promise<void> {
    await testMongo.mongo.collection<PokerRoomEntity>("pokerRooms").updateOne(
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
