import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pokerParticipantEmojis } from "./poker-participant-emojis.js";
import {
    PokerParticipant,
    PokerRoomEntity,
    PokerRound,
} from "./poker-room-entity.js";
import {
    addPokerParticipant,
    buildPokerParticipant,
    changePokerAutoReveal,
    changePokerRole,
    openPokerRoom,
    PokerRoomPatch,
    removePokerParticipant,
    renamePokerRound,
    revealPokerRound,
    revealPokerRoundIfDue,
    startPokerRound,
    votePokerRound,
} from "./poker-room-transitions.js";

const start = new Date("2026-11-01T10:00:00.000Z");
const later = new Date("2026-11-01T10:05:00.000Z");

void describe("openPokerRoom", () => {
    void it("opens the first round with the creator as the only voter", () => {
        const createdBy = new ObjectId();
        const room = openPokerRoom(
            {
                botId: "1",
                token: "token",
                createdBy,
                title: "Sprint 42",
                deck: "tShirt",
                autoReveal: true,
            },
            start,
        );

        assert.equal(room.title, "Sprint 42");
        assert.equal(room.deck, "tShirt");
        assert.deepEqual(room.autoReveal, { missingVotes: 0 });
        assert.equal(room.lastActivityAt, start);
        assert.deepEqual(
            room.participants.map(({ userId, role, joinedAt }) => ({
                userId: userId.toHexString(),
                role,
                joinedAt,
            })),
            [
                {
                    userId: createdBy.toHexString(),
                    role: "voter",
                    joinedAt: start,
                },
            ],
        );
        assert.deepEqual(room.round, {
            number: 1,
            status: "voting",
            votes: {},
            startedAt: start,
        });
        assert.deepEqual(room.rounds, []);
    });

    void it("turns auto reveal off and leaves out a missing title", () => {
        const room = openPokerRoom(
            {
                botId: "1",
                token: "token",
                createdBy: new ObjectId(),
                deck: "fibonacci",
                autoReveal: false,
            },
            start,
        );

        assert.equal(room.autoReveal, null);
        assert.equal("title" in room, false);
    });
});

void describe("buildPokerParticipant", () => {
    void it("adds a voter with an emoji that no participant has", () => {
        const [free] = pokerParticipantEmojis;
        const taken = pokerParticipantEmojis
            .filter((emoji) => emoji !== free)
            .map((emoji) => buildParticipant({ emoji }));
        const userId = new ObjectId();

        assert.deepEqual(
            buildPokerParticipant({ participants: taken }, userId, start),
            { userId, emoji: free, role: "voter", joinedAt: start },
        );
    });

    void it("keeps the emoji of a removed participant away from a newcomer", () => {
        const [free, removed] = pokerParticipantEmojis;
        const room = {
            participants: pokerParticipantEmojis
                .filter((emoji) => emoji !== free && emoji !== removed)
                .map((emoji) => buildParticipant({ emoji })),
            removedParticipants: [buildParticipant({ emoji: removed })],
        };

        assert.equal(
            buildPokerParticipant(room, new ObjectId(), start).emoji,
            free,
        );
    });

    void it("gives a newcomer the emoji of a removed participant when no other is free", () => {
        const [removed] = pokerParticipantEmojis;
        const room = {
            participants: pokerParticipantEmojis
                .filter((emoji) => emoji !== removed)
                .map((emoji) => buildParticipant({ emoji })),
            removedParticipants: [buildParticipant({ emoji: removed })],
        };

        assert.equal(
            buildPokerParticipant(room, new ObjectId(), start).emoji,
            removed,
        );
    });
});

void describe("votePokerRound", () => {
    void it("stores the card of a voter next to the other votes", () => {
        const voter = buildParticipant();
        const other = buildParticipant();
        const room = buildRoom({
            participants: [voter, other],
            round: buildRound({ votes: { [key(other)]: "3" } }),
        });

        assert.deepEqual(
            votePokerRound(room, voter.userId, { round: 1, card: "5" }),
            {
                round: {
                    ...room.round,
                    votes: { [key(other)]: "3", [key(voter)]: "5" },
                },
            },
        );
    });

    void it("replaces the card of a voter", () => {
        const voter = buildParticipant();
        const room = buildRoom({
            participants: [voter],
            round: buildRound({ votes: { [key(voter)]: "3" } }),
        });

        assert.deepEqual(
            votePokerRound(room, voter.userId, { round: 1, card: "8" })?.round
                ?.votes,
            { [key(voter)]: "8" },
        );
    });

    void it("takes the vote back when the same card is chosen again", () => {
        const voter = buildParticipant();
        const other = buildParticipant();
        const room = buildRoom({
            participants: [voter, other],
            round: buildRound({
                votes: { [key(voter)]: "5", [key(other)]: "3" },
            }),
        });

        assert.deepEqual(
            votePokerRound(room, voter.userId, { round: 1, card: "5" })?.round
                ?.votes,
            { [key(other)]: "3" },
        );
    });

    void it("ignores a vote in a revealed round or in a round that is over", () => {
        const voter = buildParticipant();
        const revealed = buildRoom({
            participants: [voter],
            round: buildRound({ status: "revealed" }),
        });
        const next = buildRoom({
            participants: [voter],
            rounds: [buildRound({ status: "revealed" })],
            round: buildRound({ number: 2 }),
        });

        assert.equal(
            votePokerRound(revealed, voter.userId, { round: 1, card: "5" }),
            null,
        );
        assert.equal(
            votePokerRound(next, voter.userId, { round: 1, card: "5" }),
            null,
        );
    });

    void it("ignores a vote of an observer and of a user outside the room", () => {
        const observer = buildParticipant({ role: "observer" });
        const room = buildRoom({ participants: [observer] });

        assert.equal(
            votePokerRound(room, observer.userId, { round: 1, card: "5" }),
            null,
        );
        assert.equal(
            votePokerRound(room, new ObjectId(), { round: 1, card: "5" }),
            null,
        );
    });

    void it("refuses a card that is not in the deck", () => {
        const voter = buildParticipant();

        assert.throws(
            () =>
                votePokerRound(
                    buildRoom({ participants: [voter] }),
                    voter.userId,
                    { round: 1, card: "XL" },
                ),
            /not in the deck/,
        );
    });
});

void describe("revealPokerRound", () => {
    void it("reveals the round of the button and keeps its votes and title", () => {
        const voter = buildParticipant();
        const room = buildRoom({
            participants: [voter],
            round: buildRound({
                title: "PROJ-1",
                votes: { [key(voter)]: "5" },
            }),
        });

        assert.deepEqual(revealPokerRound(room, 1, later), {
            round: {
                ...room.round,
                status: "revealed",
                revealedAt: later,
            },
        });
    });

    void it("ignores a revealed round and a round that is over", () => {
        const revealed = buildRoom({
            round: buildRound({ status: "revealed", revealedAt: start }),
        });
        const next = buildRoom({ round: buildRound({ number: 2 }) });

        assert.equal(revealPokerRound(revealed, 1, later), null);
        assert.equal(revealPokerRound(next, 1, later), null);
    });
});

void describe("revealPokerRoundIfDue", () => {
    void it("reveals the round with its title when the last active voter votes", () => {
        const first = buildParticipant();
        const second = buildParticipant();
        const room = buildRoom({
            autoReveal: { missingVotes: 0 },
            participants: [first, second],
            round: buildRound({
                title: "PROJ-1",
                votes: { [key(first)]: "3" },
            }),
        });
        const voted = apply(
            room,
            votePokerRound(room, second.userId, { round: 1, card: "5" }),
        );

        assert.deepEqual(revealPokerRoundIfDue(room, later), {});
        assert.deepEqual(revealPokerRoundIfDue(voted, later), {
            round: {
                number: 1,
                title: "PROJ-1",
                status: "revealed",
                votes: { [key(first)]: "3", [key(second)]: "5" },
                startedAt: start,
                revealedAt: later,
            },
        });
    });

    void it("reveals the round when everyone but the chosen number voted", () => {
        const [first, second, third] = [
            buildParticipant(),
            buildParticipant(),
            buildParticipant(),
        ];
        const room = buildRoom({
            autoReveal: { missingVotes: 1 },
            participants: [first, second, third],
            round: buildRound({ votes: { [key(first)]: "3" } }),
        });
        const voted = apply(
            room,
            votePokerRound(room, second.userId, { round: 1, card: "5" }),
        );

        assert.deepEqual(revealPokerRoundIfDue(room, later), {});
        assert.equal(
            revealPokerRoundIfDue(voted, later).round?.status,
            "revealed",
        );
    });

    void it("reveals the round at once when a lower target is already reached", () => {
        const [first, second, third] = [
            buildParticipant(),
            buildParticipant(),
            buildParticipant(),
        ];
        const room = buildRoom({
            autoReveal: { missingVotes: 0 },
            participants: [first, second, third],
            round: buildRound({
                votes: { [key(first)]: "3", [key(second)]: "5" },
            }),
        });
        const changed = apply(
            room,
            changePokerAutoReveal(room, { missingVotes: 1 }),
        );

        assert.deepEqual(revealPokerRoundIfDue(room, later), {});
        assert.equal(
            revealPokerRoundIfDue(changed, later).round?.status,
            "revealed",
        );
    });

    void it("reveals the round when the last voter without a vote starts watching", () => {
        const voted = buildParticipant();
        const waiting = buildParticipant();
        const room = buildRoom({
            autoReveal: { missingVotes: 0 },
            participants: [voted, waiting],
            round: buildRound({ votes: { [key(voted)]: "3" } }),
        });
        const changed = apply(
            room,
            changePokerRole(room, { userId: waiting.userId, role: "observer" }),
        );

        assert.equal(
            revealPokerRoundIfDue(changed, later).round?.status,
            "revealed",
        );
    });

    void it("reveals the round when the last voter without a vote is removed", () => {
        const voted = buildParticipant();
        const waiting = buildParticipant();
        const room = buildRoom({
            autoReveal: { missingVotes: 0 },
            participants: [voted, waiting],
            round: buildRound({ votes: { [key(voted)]: "3" } }),
        });
        const changed = apply(
            room,
            removePokerParticipant(room, waiting.userId, later),
        );

        assert.equal(
            revealPokerRoundIfDue(changed, later).round?.status,
            "revealed",
        );
    });

    void it("stops waiting for a voter who skipped two rounds", () => {
        const voter = buildParticipant();
        const skipper = buildParticipant();
        const room = buildRoom({
            autoReveal: { missingVotes: 0 },
            participants: [voter, skipper],
            rounds: [1, 2, 3].map((number) =>
                buildRound({
                    number,
                    status: "revealed",
                    votes: { [key(voter)]: String(number) },
                    startedAt: new Date(start.getTime() + number),
                }),
            ),
            round: buildRound({ number: 4, startedAt: later }),
        });
        const voted = apply(
            room,
            votePokerRound(room, voter.userId, { round: 4, card: "8" }),
        );

        assert.equal(
            revealPokerRoundIfDue(voted, later).round?.status,
            "revealed",
        );
    });

    void it("never reveals while auto reveal is off", () => {
        const voter = buildParticipant();
        const room = buildRoom({
            participants: [voter],
            round: buildRound({ votes: { [key(voter)]: "5" } }),
        });

        assert.deepEqual(revealPokerRoundIfDue(room, later), {});
    });
});

void describe("startPokerRound", () => {
    void it("moves the revealed round to the history and opens the next one without a title", () => {
        const voter = buildParticipant();
        const revealed = buildRound({
            title: "PROJ-1",
            status: "revealed",
            votes: { [key(voter)]: "5" },
            revealedAt: start,
        });
        const earlier = buildRound({ number: 0, status: "revealed" });
        const room = buildRoom({
            participants: [voter],
            rounds: [earlier],
            round: revealed,
        });

        assert.deepEqual(
            startPokerRound(room, { round: 1, repeat: false }, later),
            {
                rounds: [earlier, revealed],
                round: {
                    number: 2,
                    status: "voting",
                    votes: {},
                    startedAt: later,
                },
            },
        );
    });

    void it("keeps the title of the round on a revote", () => {
        const room = buildRoom({
            round: buildRound({
                title: "PROJ-2",
                status: "revealed",
                revealedAt: start,
            }),
        });

        assert.deepEqual(
            startPokerRound(room, { round: 1, repeat: true }, later)?.round,
            {
                number: 2,
                title: "PROJ-2",
                status: "voting",
                votes: {},
                startedAt: later,
            },
        );
    });

    void it("opens a revote without a title when the round had none", () => {
        const room = buildRoom({
            round: buildRound({ status: "revealed", revealedAt: start }),
        });
        const round = startPokerRound(
            room,
            { round: 1, repeat: true },
            later,
        )?.round;

        assert.ok(round);
        assert.equal("title" in round, false);
    });

    void it("ignores a round that is still open or already over", () => {
        const open = buildRoom();
        const next = buildRoom({ round: buildRound({ number: 2 }) });
        const revealedNext = buildRoom({
            round: buildRound({ number: 2, status: "revealed" }),
        });

        assert.equal(
            startPokerRound(open, { round: 1, repeat: false }, later),
            null,
        );
        assert.equal(
            startPokerRound(next, { round: 1, repeat: false }, later),
            null,
        );
        assert.equal(
            startPokerRound(revealedNext, { round: 1, repeat: true }, later),
            null,
        );
    });
});

void describe("renamePokerRound", () => {
    void it("names the current round, open or revealed", () => {
        const open = buildRoom();
        const revealed = buildRoom({
            round: buildRound({ status: "revealed", revealedAt: start }),
        });

        assert.deepEqual(
            renamePokerRound(open, { round: 1, title: "PROJ-1" }),
            { round: { ...open.round, title: "PROJ-1" } },
        );
        assert.deepEqual(
            renamePokerRound(revealed, { round: 1, title: "PROJ-1" }),
            { round: { ...revealed.round, title: "PROJ-1" } },
        );
    });

    void it("clears the title without leaving an empty field", () => {
        const room = buildRoom({ round: buildRound({ title: "PROJ-1" }) });
        const round = renamePokerRound(room, {
            round: 1,
            title: undefined,
        })?.round;

        assert.ok(round);
        assert.equal("title" in round, false);
    });

    void it("ignores the title the round already has", () => {
        const named = buildRoom({ round: buildRound({ title: "PROJ-1" }) });

        assert.equal(
            renamePokerRound(named, { round: 1, title: "PROJ-1" }),
            null,
        );
        assert.equal(
            renamePokerRound(buildRoom(), { round: 1, title: undefined }),
            null,
        );
    });

    void it("ignores a title for a round that is over", () => {
        const room = buildRoom({ round: buildRound({ number: 2 }) });

        assert.equal(
            renamePokerRound(room, { round: 1, title: "PROJ-1" }),
            null,
        );
    });
});

void describe("changePokerRole", () => {
    void it("makes a voter an observer and drops the vote of the open round", () => {
        const watcher = buildParticipant();
        const other = buildParticipant();
        const room = buildRoom({
            participants: [watcher, other],
            round: buildRound({
                votes: { [key(watcher)]: "5", [key(other)]: "3" },
            }),
        });
        const changed = apply(
            room,
            changePokerRole(room, {
                userId: watcher.userId,
                role: "observer",
            }),
        );

        assert.deepEqual(
            changed.participants.map(({ role }) => role),
            ["observer", "voter"],
        );
        assert.deepEqual(changed.round.votes, { [key(other)]: "3" });
        assert.equal(
            votePokerRound(changed, watcher.userId, { round: 1, card: "8" }),
            null,
        );
    });

    void it("keeps every vote of a revealed round when a voter starts watching", () => {
        const watcher = buildParticipant();
        const room = buildRoom({
            participants: [watcher],
            round: buildRound({
                status: "revealed",
                votes: { [key(watcher)]: "5" },
            }),
        });

        assert.deepEqual(
            changePokerRole(room, {
                userId: watcher.userId,
                role: "observer",
            }),
            { participants: [{ ...watcher, role: "observer" }] },
        );
    });

    void it("makes an observer a voter again", () => {
        const observer = buildParticipant({ role: "observer" });
        const room = buildRoom({ participants: [observer] });

        assert.deepEqual(
            changePokerRole(room, { userId: observer.userId, role: "voter" }),
            { participants: [{ ...observer, role: "voter" }] },
        );
    });

    void it("ignores the role the participant already has", () => {
        const voter = buildParticipant();
        const room = buildRoom({ participants: [voter] });

        assert.equal(
            changePokerRole(room, { userId: voter.userId, role: "voter" }),
            null,
        );
    });

    void it("ignores a user outside the room", () => {
        const room = buildRoom({ participants: [buildParticipant()] });

        assert.equal(
            changePokerRole(room, {
                userId: new ObjectId(),
                role: "observer",
            }),
            null,
        );
    });
});

void describe("changePokerAutoReveal", () => {
    void it("sets a new target and turns auto reveal off", () => {
        const room = buildRoom({ autoReveal: { missingVotes: 0 } });

        assert.deepEqual(changePokerAutoReveal(room, { missingVotes: 1 }), {
            autoReveal: { missingVotes: 1 },
        });
        assert.deepEqual(changePokerAutoReveal(room, null), {
            autoReveal: null,
        });
    });

    void it("ignores the target the room already has", () => {
        assert.equal(
            changePokerAutoReveal(
                buildRoom({ autoReveal: { missingVotes: 1 } }),
                { missingVotes: 1 },
            ),
            null,
        );
        assert.equal(
            changePokerAutoReveal(buildRoom({ autoReveal: null }), null),
            null,
        );
    });
});

void describe("addPokerParticipant", () => {
    void it("adds the participant last and leaves out removals of a room without them", () => {
        const first = buildParticipant();
        const added = buildParticipant();

        assert.deepEqual(
            addPokerParticipant(buildRoom({ participants: [first] }), added),
            { participants: [first, added] },
        );
    });

    void it("drops the old record of a removed user who joins again", () => {
        const first = buildParticipant();
        const other = buildParticipant();
        const returning = buildParticipant();
        const again = { ...returning, emoji: "🐼", joinedAt: later };
        const room = buildRoom({
            participants: [first],
            removedParticipants: [returning, other],
        });

        assert.deepEqual(addPokerParticipant(room, again), {
            participants: [first, again],
            removedParticipants: [other],
        });
    });
});

void describe("removePokerParticipant", () => {
    void it("moves the participant to the removed ones and drops the vote of the open round", () => {
        const creator = buildParticipant();
        const member = buildParticipant();
        const room = buildRoom({
            participants: [creator, member],
            round: buildRound({
                votes: { [key(creator)]: "3", [key(member)]: "5" },
            }),
        });

        assert.deepEqual(removePokerParticipant(room, creator.userId, later), {
            participants: [member],
            removedParticipants: [creator],
            round: { ...room.round, votes: { [key(member)]: "5" } },
        });
    });

    void it("keeps every vote of a revealed round", () => {
        const creator = buildParticipant();
        const member = buildParticipant();
        const room = buildRoom({
            participants: [creator, member],
            round: buildRound({
                status: "revealed",
                votes: { [key(member)]: "5" },
            }),
        });

        assert.deepEqual(removePokerParticipant(room, member.userId, later), {
            participants: [creator],
            removedParticipants: [member],
        });
    });

    void it("closes the room when its last participant leaves", () => {
        const creator = buildParticipant();
        const room = buildRoom({ participants: [creator] });

        assert.deepEqual(removePokerParticipant(room, creator.userId, later), {
            participants: [],
            closedAt: later,
            removedParticipants: [creator],
            round: room.round,
        });
    });

    void it("keeps one record of a user who was removed before", () => {
        const stays = buildParticipant();
        const returning = buildParticipant();
        const again = { ...returning, emoji: "🐼", joinedAt: later };
        const other = buildParticipant();
        const room = buildRoom({
            participants: [stays, again],
            removedParticipants: [returning, other],
        });

        assert.deepEqual(
            removePokerParticipant(room, again.userId, later)
                ?.removedParticipants,
            [other, again],
        );
    });

    void it("ignores a user outside the room", () => {
        const room = buildRoom({ participants: [buildParticipant()] });

        assert.equal(removePokerParticipant(room, new ObjectId(), later), null);
    });
});

function buildRoom(overrides: Partial<PokerRoomEntity> = {}): PokerRoomEntity {
    return {
        _id: new ObjectId(),
        version: 0,
        createdAt: start,
        updatedAt: start,
        botId: "1",
        token: "token",
        createdBy: new ObjectId(),
        deck: "fibonacciModified",
        autoReveal: null,
        lastActivityAt: start,
        participants: [],
        round: buildRound(),
        rounds: [],
        ...overrides,
    };
}

function buildParticipant(
    overrides: Partial<PokerParticipant> = {},
): PokerParticipant {
    return {
        userId: new ObjectId(),
        emoji: "🦊",
        role: "voter",
        joinedAt: start,
        ...overrides,
    };
}

function buildRound(overrides: Partial<PokerRound> = {}): PokerRound {
    return {
        number: 1,
        status: "voting",
        votes: {},
        startedAt: start,
        ...overrides,
    };
}

function apply(
    room: PokerRoomEntity,
    patch: PokerRoomPatch | null,
): PokerRoomEntity {
    assert.ok(patch);

    return { ...room, ...patch };
}

function key(participant: PokerParticipant): string {
    return participant.userId.toHexString();
}
