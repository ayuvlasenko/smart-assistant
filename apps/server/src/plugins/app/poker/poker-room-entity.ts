import { ObjectId } from "mongodb";
import { BaseEntity } from "../../../entity.js";
import { PokerDeckName } from "./poker-decks.js";

export interface PokerParticipant {
    userId: ObjectId;
    emoji: string;
    joinedAt: Date;
}

export type PokerRoundStatus = "voting" | "revealed";

export interface PokerRound {
    number: number;
    title?: string;
    status: PokerRoundStatus;
    votes: Record<string, string>;
    startedAt: Date;
    revealedAt?: Date;
}

export interface PokerRoomEntity extends BaseEntity {
    token: string;
    createdBy: ObjectId;
    title?: string;
    deck: PokerDeckName;
    autoReveal: boolean;
    lastActivityAt: Date;
    closedAt?: Date;
    participants: PokerParticipant[];
    round: PokerRound;
    rounds: PokerRound[];
}

export interface PokerSubjects {
    PokerRoom: PokerRoomEntity;
}

export type PokerRoomStatus = "open" | "closed";

export const pokerRoomIdleMilliseconds = 24 * 60 * 60 * 1000;

const idleAfterSkippedRounds = 2;

export function readPokerRoomStatus(
    room: PokerRoomEntity,
    now: Date,
): PokerRoomStatus {
    const isIdle =
        room.lastActivityAt.getTime() + pokerRoomIdleMilliseconds <=
        now.getTime();

    return room.closedAt || isIdle ? "closed" : "open";
}

export function listRevealedPokerRounds(room: PokerRoomEntity): PokerRound[] {
    return room.round.status === "revealed"
        ? [...room.rounds, room.round]
        : room.rounds;
}

export function isPokerParticipantIdle(
    room: PokerRoomEntity,
    participant: PokerParticipant,
): boolean {
    const userId = participant.userId.toHexString();

    if (room.round.status === "voting" && room.round.votes[userId]) {
        return false;
    }

    const roundsSinceJoin = listRevealedPokerRounds(room)
        .filter(({ startedAt }) => startedAt >= participant.joinedAt)
        .slice(-idleAfterSkippedRounds);

    return (
        roundsSinceJoin.length === idleAfterSkippedRounds &&
        roundsSinceJoin.every(({ votes }) => !votes[userId])
    );
}

export function listActivePokerParticipants(
    room: PokerRoomEntity,
): PokerParticipant[] {
    return room.participants.filter(
        (participant) => !isPokerParticipantIdle(room, participant),
    );
}
