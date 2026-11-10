import { ObjectId } from "mongodb";
import { BaseEntity } from "../../../entity.js";
import { PokerDeckName } from "./poker-decks.js";

export interface PokerParticipant {
    userId: ObjectId;
    emoji: string;
    joinedAt: Date;
}

export type PokerAutoReveal = "off" | "all" | number;

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
    autoReveal: PokerAutoReveal;
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

export function findPokerParticipant(
    room: PokerRoomEntity,
    userId: ObjectId,
): PokerParticipant | undefined {
    return room.participants.find((participant) =>
        participant.userId.equals(userId),
    );
}

export function listActivePokerParticipants(
    room: PokerRoomEntity,
): PokerParticipant[] {
    return room.participants.filter(
        (participant) => !isPokerParticipantIdle(room, participant),
    );
}

export function readPokerAutoRevealTarget(
    room: PokerRoomEntity,
): number | null {
    const active = listActivePokerParticipants(room).length;

    if (room.autoReveal === "off") {
        return null;
    }

    return room.autoReveal === "all"
        ? active
        : Math.min(room.autoReveal, active);
}

export function stepPokerAutoReveal(
    room: PokerRoomEntity,
    step: -1 | 1,
): PokerAutoReveal {
    const active = listActivePokerParticipants(room).length;
    const votes = (readPokerAutoRevealTarget(room) ?? 0) + step;

    const bound: PokerAutoReveal = votes <= 0 ? "off" : "all";

    return votes > 0 && votes < active ? votes : bound;
}

export function isPokerAutoRevealDue(room: PokerRoomEntity): boolean {
    const target = readPokerAutoRevealTarget(room);
    const voted = listActivePokerParticipants(room).filter(
        ({ userId }) => room.round.votes[userId.toHexString()],
    ).length;

    return (
        room.round.status === "voting" &&
        target !== null &&
        target > 0 &&
        voted >= target
    );
}
