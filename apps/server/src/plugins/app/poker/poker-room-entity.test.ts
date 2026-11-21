import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    countPokerVotes,
    isPokerAutoRevealDue,
    isPokerParticipantIdle,
    isPokerTitleTooLong,
    listActivePokerParticipants,
    listKnownPokerParticipants,
    listRevealedPokerRounds,
    PokerAutoReveal,
    PokerParticipant,
    PokerRoomEntity,
    pokerRoomIdleMilliseconds,
    PokerRound,
    readPokerAutoRevealTarget,
    readPokerRoomStatus,
    readPokerTitle,
    stepPokerAutoReveal,
} from "./poker-room-entity.js";

interface VotingRoomOptions {
    voters?: number;
    observers?: number;
    votes?: number;
    autoReveal: PokerAutoReveal;
}

const start = new Date("2026-11-01T10:00:00.000Z");

void describe("readPokerRoomStatus", () => {
    void it("keeps a room open until a day passes after its last change", () => {
        const room = buildRoom({ lastActivityAt: start });

        assert.equal(
            readPokerRoomStatus(
                room,
                new Date(start.getTime() + pokerRoomIdleMilliseconds - 1),
            ),
            "open",
        );
        assert.equal(
            readPokerRoomStatus(
                room,
                new Date(start.getTime() + pokerRoomIdleMilliseconds),
            ),
            "closed",
        );
    });

    void it("closes a room that a participant closed, right after its last change", () => {
        const room = buildRoom({ lastActivityAt: start, closedAt: start });

        assert.equal(readPokerRoomStatus(room, start), "closed");
    });
});

void describe("listRevealedPokerRounds", () => {
    void it("adds the current round once it is revealed", () => {
        const finished = buildRound({ number: 1, status: "revealed" });
        const voting = buildRoom({
            rounds: [finished],
            round: buildRound({ number: 2 }),
        });
        const revealed = buildRoom({
            rounds: [finished],
            round: buildRound({ number: 2, status: "revealed" }),
        });

        assert.deepEqual(
            listRevealedPokerRounds(voting).map(({ number }) => number),
            [1],
        );
        assert.deepEqual(
            listRevealedPokerRounds(revealed).map(({ number }) => number),
            [1, 2],
        );
    });
});

void describe("listKnownPokerParticipants", () => {
    void it("lists the participants and then the removed ones", () => {
        const stays = buildParticipant();
        const removed = buildParticipant();

        assert.deepEqual(
            listKnownPokerParticipants(
                buildRoom({
                    participants: [stays],
                    removedParticipants: [removed],
                }),
            ),
            [stays, removed],
        );
        assert.deepEqual(
            listKnownPokerParticipants(buildRoom({ participants: [stays] })),
            [stays],
        );
    });
});

void describe("isPokerParticipantIdle", () => {
    void it("makes a voter idle after no vote in the last two revealed rounds", () => {
        const voter = buildParticipant();
        const room = buildRoom({
            participants: [voter],
            rounds: [revealedRound(1, {}), revealedRound(2, {})],
            round: buildRound({ number: 3, startedAt: minutes(3) }),
        });

        assert.equal(isPokerParticipantIdle(room, voter), true);
    });

    void it("keeps a voter active with a vote in one of the last two revealed rounds", () => {
        const voter = buildParticipant();
        const room = buildRoom({
            participants: [voter],
            rounds: [
                revealedRound(1, {}),
                revealedRound(2, { [key(voter)]: "5" }),
                revealedRound(3, {}),
            ],
            round: buildRound({ number: 4, startedAt: minutes(4) }),
        });

        assert.equal(isPokerParticipantIdle(room, voter), false);
    });

    void it("doesn't count the rounds that started before the join", () => {
        const voter = buildParticipant({ joinedAt: minutes(1.5) });
        const room = buildRoom({
            participants: [voter],
            rounds: [revealedRound(1, {}), revealedRound(2, {})],
            round: buildRound({ number: 3, startedAt: minutes(3) }),
        });

        assert.equal(isPokerParticipantIdle(room, voter), false);
    });

    void it("counts the current round once it is revealed, but not while it is open", () => {
        const voter = buildParticipant();
        const open = buildRoom({
            participants: [voter],
            rounds: [revealedRound(1, {})],
            round: buildRound({ number: 2, startedAt: minutes(2) }),
        });
        const revealed = buildRoom({
            participants: [voter],
            rounds: [revealedRound(1, {})],
            round: revealedRound(2, {}),
        });

        assert.equal(isPokerParticipantIdle(open, voter), false);
        assert.equal(isPokerParticipantIdle(revealed, voter), true);
    });

    void it("makes an idle voter active at once with a vote in the open round", () => {
        const voter = buildParticipant();
        const room = buildRoom({
            participants: [voter],
            rounds: [revealedRound(1, {}), revealedRound(2, {})],
            round: buildRound({
                number: 3,
                startedAt: minutes(3),
                votes: { [key(voter)]: "8" },
            }),
        });

        assert.equal(isPokerParticipantIdle(room, voter), false);
    });
});

void describe("listActivePokerParticipants", () => {
    void it("drops the observers and the idle voters", () => {
        const active = buildParticipant();
        const idle = buildParticipant();
        const observer = buildParticipant({ role: "observer" });
        const room = buildRoom({
            participants: [active, idle, observer],
            rounds: [
                revealedRound(1, { [key(active)]: "3" }),
                revealedRound(2, {}),
            ],
            round: buildRound({ number: 3, startedAt: minutes(3) }),
        });

        assert.deepEqual(listActivePokerParticipants(room), [active]);
    });
});

void describe("readPokerAutoRevealTarget", () => {
    void it("has no target while auto reveal is off", () => {
        assert.equal(
            readPokerAutoRevealTarget(buildVotingRoom({ autoReveal: null })),
            null,
        );
    });

    void it("waits for the active participants but the chosen number", () => {
        const cases: {
            voters: number;
            observers: number;
            missingVotes: number;
            target: number;
        }[] = [
            { voters: 4, observers: 0, missingVotes: 0, target: 4 },
            { voters: 4, observers: 0, missingVotes: 1, target: 3 },
            { voters: 3, observers: 2, missingVotes: 0, target: 3 },
            { voters: 2, observers: 0, missingVotes: 2, target: 1 },
            { voters: 2, observers: 0, missingVotes: 5, target: 1 },
            { voters: 0, observers: 3, missingVotes: 0, target: 1 },
        ];

        for (const { voters, observers, missingVotes, target } of cases) {
            assert.equal(
                readPokerAutoRevealTarget(
                    buildVotingRoom({
                        voters,
                        observers,
                        autoReveal: { missingVotes },
                    }),
                ),
                target,
                `${voters} voters, ${observers} observers, ${missingVotes} missing`,
            );
        }
    });

    void it("waits for one vote when every voter is idle", () => {
        const first = buildParticipant();
        const second = buildParticipant();
        const room = buildRoom({
            autoReveal: { missingVotes: 0 },
            participants: [first, second],
            rounds: [revealedRound(1, {}), revealedRound(2, {})],
            round: buildRound({ number: 3, startedAt: minutes(3) }),
        });

        assert.equal(readPokerAutoRevealTarget(room), 1);
    });
});

void describe("stepPokerAutoReveal", () => {
    const cases: {
        name: string;
        autoReveal: PokerAutoReveal;
        step: -1 | 1;
        result: PokerAutoReveal;
    }[] = [
        {
            name: "lowers everyone to everyone but one",
            autoReveal: { missingVotes: 0 },
            step: -1,
            result: { missingVotes: 1 },
        },
        {
            name: "lowers a target of 3 to a target of 2",
            autoReveal: { missingVotes: 1 },
            step: -1,
            result: { missingVotes: 2 },
        },
        {
            name: "turns auto reveal off below a target of 1",
            autoReveal: { missingVotes: 3 },
            step: -1,
            result: null,
        },
        {
            name: "keeps auto reveal off on a step down",
            autoReveal: null,
            step: -1,
            result: null,
        },
        {
            name: "turns auto reveal on at a target of 1",
            autoReveal: null,
            step: 1,
            result: { missingVotes: 3 },
        },
        {
            name: "raises a target of 3 to everyone",
            autoReveal: { missingVotes: 1 },
            step: 1,
            result: { missingVotes: 0 },
        },
        {
            name: "keeps everyone on a step up",
            autoReveal: { missingVotes: 0 },
            step: 1,
            result: { missingVotes: 0 },
        },
        {
            name: "steps from the target that a missing count above the room gives",
            autoReveal: { missingVotes: 9 },
            step: 1,
            result: { missingVotes: 2 },
        },
    ];

    for (const { name, autoReveal, step, result } of cases) {
        void it(`${name} in a room of four active participants`, () => {
            assert.deepEqual(
                stepPokerAutoReveal(
                    buildVotingRoom({ voters: 4, autoReveal }),
                    step,
                ),
                result,
            );
        });
    }

    void it("counts only the active participants", () => {
        assert.deepEqual(
            stepPokerAutoReveal(
                buildVotingRoom({
                    voters: 2,
                    observers: 2,
                    autoReveal: { missingVotes: 0 },
                }),
                -1,
            ),
            { missingVotes: 1 },
        );
    });
});

void describe("countPokerVotes", () => {
    void it("counts the votes of the active participants only", () => {
        const voted = buildParticipant();
        const waiting = buildParticipant();
        const observer = buildParticipant({ role: "observer" });
        const room = buildRoom({
            participants: [voted, waiting, observer],
            round: buildRound({
                votes: {
                    [key(voted)]: "5",
                    [key(observer)]: "8",
                    [new ObjectId().toHexString()]: "3",
                },
            }),
        });

        assert.equal(countPokerVotes(room), 1);
    });
});

void describe("isPokerAutoRevealDue", () => {
    void it("is due once the votes reach the target", () => {
        const room = buildVotingRoom({
            voters: 3,
            votes: 2,
            autoReveal: { missingVotes: 0 },
        });

        assert.equal(isPokerAutoRevealDue(room), false);
        assert.equal(
            isPokerAutoRevealDue({
                ...room,
                autoReveal: { missingVotes: 1 },
            }),
            true,
        );
    });

    void it("is never due while auto reveal is off", () => {
        assert.equal(
            isPokerAutoRevealDue(
                buildVotingRoom({ voters: 2, votes: 2, autoReveal: null }),
            ),
            false,
        );
    });

    void it("is not due in a revealed round", () => {
        const room = buildVotingRoom({
            voters: 2,
            votes: 2,
            autoReveal: { missingVotes: 0 },
        });

        assert.equal(
            isPokerAutoRevealDue({
                ...room,
                round: { ...room.round, status: "revealed" },
            }),
            false,
        );
    });
});

void describe("readPokerTitle", () => {
    void it("trims the title and gives none for a blank one", () => {
        assert.equal(readPokerTitle("  Sprint 43  ", 64), "Sprint 43");
        assert.equal(readPokerTitle("   ", 64), undefined);
        assert.equal(readPokerTitle("", 64), undefined);
        assert.equal(readPokerTitle(undefined, 64), undefined);
    });

    void it("refuses a title over the limit after the trim", () => {
        assert.equal(readPokerTitle(` ${"x".repeat(64)} `, 64), "x".repeat(64));
        assert.throws(
            () => readPokerTitle("x".repeat(65), 64),
            /longer than 64 characters/,
        );
    });

    void it("counts an emoji of several code points as one character", () => {
        const family = "👨‍👩‍👧";

        assert.equal(readPokerTitle(family.repeat(3), 3), family.repeat(3));
        assert.equal(isPokerTitleTooLong(family.repeat(3), 3), false);
        assert.equal(isPokerTitleTooLong(family.repeat(4), 3), true);
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

function buildVotingRoom({
    voters = 2,
    observers = 0,
    votes = 0,
    autoReveal,
}: VotingRoomOptions): PokerRoomEntity {
    const participants = [
        ...Array.from({ length: voters }, () => buildParticipant()),
        ...Array.from({ length: observers }, () =>
            buildParticipant({ role: "observer" }),
        ),
    ];

    return buildRoom({
        autoReveal,
        participants,
        round: buildRound({
            votes: Object.fromEntries(
                participants.slice(0, votes).map((voter) => [key(voter), "5"]),
            ),
        }),
    });
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

function revealedRound(number: number, votes: PokerRound["votes"]): PokerRound {
    return buildRound({
        number,
        status: "revealed",
        votes,
        startedAt: minutes(number),
        revealedAt: minutes(number + 0.5),
    });
}

function minutes(count: number): Date {
    const offset = count * 60_000;

    return new Date(start.getTime() + offset);
}

function key(participant: PokerParticipant): string {
    return participant.userId.toHexString();
}
