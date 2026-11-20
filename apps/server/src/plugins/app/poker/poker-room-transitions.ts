import { ObjectId } from "mongodb";
import { BaseEntity } from "../../../entity.js";
import { PokerDeckName, readPokerDeck } from "./poker-decks.js";
import { pickPokerParticipantEmoji } from "./poker-participant-emojis.js";
import {
    findPokerParticipant,
    isPokerAutoRevealDue,
    PokerAutoReveal,
    PokerParticipant,
    PokerParticipantRole,
    PokerRoomEntity,
    PokerRound,
} from "./poker-room-entity.js";

export type NewPokerRoom = Omit<PokerRoomEntity, keyof BaseEntity>;

export interface PokerRoomOpening {
    botId: string;
    token: string;
    createdBy: ObjectId;
    title?: string;
    deck: PokerDeckName;
    autoReveal: boolean;
}

export type PokerRoomPatch = Partial<
    Pick<
        PokerRoomEntity,
        | "autoReveal"
        | "closedAt"
        | "participants"
        | "removedParticipants"
        | "round"
        | "rounds"
    >
>;

export interface PokerVote {
    round: number;
    card: string;
}

export interface PokerRoundStart {
    round: number;
    repeat: boolean;
}

export interface PokerRoundRename {
    round: number;
    title: string | undefined;
}

export interface PokerRoleChange {
    userId: ObjectId;
    role: PokerParticipantRole;
}

export function openPokerRoom(
    { autoReveal, title, ...opening }: PokerRoomOpening,
    now: Date,
): NewPokerRoom {
    return {
        ...opening,
        ...(title === undefined ? {} : { title }),
        autoReveal: autoReveal ? { missingVotes: 0 } : null,
        lastActivityAt: now,
        participants: [buildPokerParticipant([], opening.createdBy, now)],
        round: { number: 1, status: "voting", votes: {}, startedAt: now },
        rounds: [],
    };
}

export function buildPokerParticipant(
    participants: PokerParticipant[],
    userId: ObjectId,
    now: Date,
): PokerParticipant {
    return {
        userId,
        emoji: pickPokerParticipantEmoji(
            participants.map(({ emoji }) => emoji),
        ),
        role: "voter",
        joinedAt: now,
    };
}

export function votePokerRound(
    room: PokerRoomEntity,
    userId: ObjectId,
    { round, card }: PokerVote,
): PokerRoomPatch | null {
    if (!readPokerDeck(room.deck).cards.includes(card)) {
        throw new Error(`Poker card "${card}" is not in the deck`);
    }

    const voter = findPokerParticipant(room, userId);

    if (!isVotingRound(room, round) || !voter || voter.role === "observer") {
        return null;
    }

    const key = userId.toHexString();
    const votes = withoutVote(room.round.votes, userId);

    return {
        round: {
            ...room.round,
            votes:
                room.round.votes[key] === card
                    ? votes
                    : { ...votes, [key]: card },
        },
    };
}

export function revealPokerRound(
    room: PokerRoomEntity,
    round: number,
    now: Date,
): PokerRoomPatch | null {
    return isVotingRound(room, round) ? revealRound(room, now) : null;
}

export function revealPokerRoundIfDue(
    room: PokerRoomEntity,
    now: Date,
): PokerRoomPatch {
    return isPokerAutoRevealDue(room) ? revealRound(room, now) : {};
}

export function startPokerRound(
    room: PokerRoomEntity,
    { round, repeat }: PokerRoundStart,
    now: Date,
): PokerRoomPatch | null {
    if (room.round.number !== round || room.round.status !== "revealed") {
        return null;
    }

    return {
        rounds: [...room.rounds, room.round],
        round: {
            number: round + 1,
            ...(repeat && room.round.title ? { title: room.round.title } : {}),
            status: "voting",
            votes: {},
            startedAt: now,
        },
    };
}

export function renamePokerRound(
    room: PokerRoomEntity,
    { round, title }: PokerRoundRename,
): PokerRoomPatch | null {
    if (room.round.number !== round) {
        return null;
    }

    const renamed = { ...room.round, title };

    if (title === undefined) {
        delete renamed.title;
    }

    return { round: renamed };
}

export function changePokerRole(
    room: PokerRoomEntity,
    change: PokerRoleChange,
): PokerRoomPatch | null {
    if (!findPokerParticipant(room, change.userId)) {
        return null;
    }

    return {
        participants: room.participants.map((participant) =>
            withRole(participant, change),
        ),
        ...(change.role === "observer"
            ? withoutOpenVote(room, change.userId)
            : {}),
    };
}

export function changePokerAutoReveal(
    autoReveal: PokerAutoReveal,
): PokerRoomPatch {
    return { autoReveal };
}

export function closePokerRoom(now: Date): PokerRoomPatch {
    return { closedAt: now };
}

export function addPokerParticipant(
    room: PokerRoomEntity,
    participant: PokerParticipant,
): PokerRoomPatch {
    return {
        participants: [...room.participants, participant],
        ...(room.removedParticipants
            ? {
                  removedParticipants: withoutParticipant(
                      room.removedParticipants,
                      participant.userId,
                  ),
              }
            : {}),
    };
}

export function removePokerParticipant(
    room: PokerRoomEntity,
    userId: ObjectId,
    now: Date,
): PokerRoomPatch | null {
    const participant = findPokerParticipant(room, userId);

    if (!participant) {
        return null;
    }

    const participants = withoutParticipant(room.participants, userId);

    return {
        participants,
        ...(participants.length ? {} : closePokerRoom(now)),
        removedParticipants: [
            ...withoutParticipant(room.removedParticipants ?? [], userId),
            participant,
        ],
        ...withoutOpenVote(room, userId),
    };
}

function isVotingRound(room: PokerRoomEntity, round: number): boolean {
    return room.round.number === round && room.round.status === "voting";
}

function revealRound(room: PokerRoomEntity, now: Date): PokerRoomPatch {
    return { round: { ...room.round, status: "revealed", revealedAt: now } };
}

function withoutVote(
    votes: PokerRound["votes"],
    userId: ObjectId,
): PokerRound["votes"] {
    const key = userId.toHexString();

    return Object.fromEntries(
        Object.entries(votes).filter(([voterId]) => voterId !== key),
    );
}

function withRole(
    participant: PokerParticipant,
    { userId, role }: PokerRoleChange,
): PokerParticipant {
    return participant.userId.equals(userId)
        ? { ...participant, role }
        : participant;
}

function withoutParticipant(
    participants: PokerParticipant[],
    userId: ObjectId,
): PokerParticipant[] {
    return participants.filter(
        (participant) => !participant.userId.equals(userId),
    );
}

function withoutOpenVote(
    room: PokerRoomEntity,
    userId: ObjectId,
): PokerRoomPatch {
    return room.round.status === "voting"
        ? {
              round: {
                  ...room.round,
                  votes: withoutVote(room.round.votes, userId),
              },
          }
        : {};
}
