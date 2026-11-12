import { ObjectId } from "mongodb";
import {
    findPokerParticipant,
    isPokerAutoRevealDue,
    PokerParticipant,
    PokerParticipantRole,
    PokerRoomEntity,
    PokerRound,
} from "./poker-room-entity.js";

export type PokerRoomPatch = Partial<
    Pick<
        PokerRoomEntity,
        "autoReveal" | "closedAt" | "participants" | "round" | "rounds"
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

export function votePokerRound(
    room: PokerRoomEntity,
    userId: ObjectId,
    { round, card }: PokerVote,
): PokerRoomPatch | null {
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
