import { FastifyMongoObject } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Filter, ObjectId } from "mongodb";
import {
    PokerParticipant,
    PokerRoomEntity,
    pokerRoomIdleMilliseconds,
    PokerRoomStatus,
    PokerRound,
} from "./poker-room-entity.js";

export type PokerRoomData = Pick<
    PokerRoomEntity,
    "token" | "createdBy" | "deck" | "autoReveal" | "participants"
> &
    Partial<Pick<PokerRoomEntity, "title">>;

export interface PokerRoomsQuery {
    filter: Filter<PokerRoomEntity>;
    status: PokerRoomStatus;
    now: Date;
}

export interface PokerRoomsPageOptions extends PokerRoomsQuery {
    skip: number;
    limit: number;
}

export interface PokerRoomTarget {
    roomId: ObjectId;
    userId: ObjectId;
    now: Date;
}

export interface PokerRoundTarget extends PokerRoomTarget {
    roundNumber: number;
}

export interface PokerJoinLimits {
    isEmojiFree: boolean;
    maxParticipants: number;
}

const bump = { $inc: { version: 1 } };

export class PokerRoomsRepository {
    readonly mongo: Required<FastifyMongoObject>;

    constructor(mongo: Required<FastifyMongoObject>) {
        this.mongo = mongo;
    }

    async create(data: PokerRoomData, now: Date): Promise<PokerRoomEntity> {
        const room: PokerRoomEntity = {
            _id: new ObjectId(),
            ...data,
            lastActivityAt: now,
            round: { number: 1, status: "voting", votes: {}, startedAt: now },
            rounds: [],
            version: 0,
            createdAt: now,
            updatedAt: now,
        };

        await this.collection().insertOne(room);

        return room;
    }

    findOne(filter: Filter<PokerRoomEntity>): Promise<PokerRoomEntity | null> {
        return this.collection().findOne(filter);
    }

    findOneByToken(token: string): Promise<PokerRoomEntity | null> {
        return this.collection().findOne({ token });
    }

    findPage({
        skip,
        limit,
        ...query
    }: PokerRoomsPageOptions): Promise<PokerRoomEntity[]> {
        return this.collection()
            .find(queryFilter(query))
            .sort({ lastActivityAt: -1, _id: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
    }

    count(query: PokerRoomsQuery): Promise<number> {
        return this.collection().countDocuments(queryFilter(query));
    }

    join(
        token: string,
        participant: PokerParticipant,
        { isEmojiFree, maxParticipants }: PokerJoinLimits,
    ): Promise<PokerRoomEntity | null> {
        const now = participant.joinedAt;

        return this.collection().findOneAndUpdate(
            {
                token,
                ...statusFilter("open", now),
                "participants.userId": { $ne: participant.userId },
                [`participants.${maxParticipants - 1}`]: { $exists: false },
                ...(isEmojiFree
                    ? { "participants.emoji": { $ne: participant.emoji } }
                    : {}),
            },
            {
                $push: { participants: participant },
                ...touch(now),
            },
            { returnDocument: "after" },
        );
    }

    vote(
        target: PokerRoundTarget,
        card: string | undefined,
    ): Promise<PokerRoomEntity | null> {
        const field = `round.votes.${target.userId.toHexString()}`;

        return this.collection().findOneAndUpdate(
            { ...roundFilter(target), "round.status": "voting" },
            card === undefined
                ? { $unset: { [field]: "" }, ...touch(target.now) }
                : { $set: { [field]: card, ...touched(target.now) }, ...bump },
            { returnDocument: "after" },
        );
    }

    reveal(target: PokerRoundTarget): Promise<PokerRoomEntity | null> {
        return this.collection().findOneAndUpdate(
            { ...roundFilter(target), "round.status": "voting" },
            {
                $set: {
                    "round.status": "revealed",
                    "round.revealedAt": target.now,
                    ...touched(target.now),
                },
                ...bump,
            },
            { returnDocument: "after" },
        );
    }

    startRound(
        target: PokerRoundTarget,
        { repeat }: { repeat: boolean },
    ): Promise<PokerRoomEntity | null> {
        const round: Record<keyof PokerRound, unknown> = {
            number: { $literal: target.roundNumber + 1 },
            title: repeat ? "$round.title" : "$$REMOVE",
            status: { $literal: "voting" },
            votes: { $literal: {} },
            startedAt: { $literal: target.now },
            revealedAt: "$$REMOVE",
        };

        return this.collection().findOneAndUpdate(
            { ...roundFilter(target), "round.status": "revealed" },
            [
                {
                    $set: {
                        rounds: { $concatArrays: ["$rounds", ["$round"]] },
                        round,
                        lastActivityAt: target.now,
                        updatedAt: target.now,
                        version: { $add: ["$version", 1] },
                    },
                },
            ],
            { returnDocument: "after" },
        );
    }

    renameRound(
        target: PokerRoundTarget,
        title: string | undefined,
    ): Promise<PokerRoomEntity | null> {
        return this.collection().findOneAndUpdate(
            roundFilter(target),
            title === undefined
                ? { $unset: { "round.title": "" }, ...touch(target.now) }
                : {
                      $set: { "round.title": title, ...touched(target.now) },
                      ...bump,
                  },
            { returnDocument: "after" },
        );
    }

    close(target: PokerRoomTarget): Promise<PokerRoomEntity | null> {
        return this.collection().findOneAndUpdate(
            {
                _id: target.roomId,
                createdBy: target.userId,
                ...statusFilter("open", target.now),
            },
            {
                $set: { closedAt: target.now, updatedAt: target.now },
                ...bump,
            },
            { returnDocument: "after" },
        );
    }

    private collection() {
        return this.mongo.db.collection<PokerRoomEntity>("pokerRooms");
    }
}

function queryFilter({
    filter,
    status,
    now,
}: PokerRoomsQuery): Filter<PokerRoomEntity> {
    return { $and: [filter, statusFilter(status, now)] };
}

function statusFilter(
    status: PokerRoomStatus,
    now: Date,
): Filter<PokerRoomEntity> {
    const idleSince = new Date(now.getTime() - pokerRoomIdleMilliseconds);

    return status === "open"
        ? { closedAt: { $exists: false }, lastActivityAt: { $gt: idleSince } }
        : {
              $or: [
                  { closedAt: { $exists: true } },
                  { lastActivityAt: { $lte: idleSince } },
              ],
          };
}

function roundFilter({
    roomId,
    roundNumber,
    userId,
    now,
}: PokerRoundTarget): Filter<PokerRoomEntity> {
    return {
        _id: roomId,
        ...statusFilter("open", now),
        "round.number": roundNumber,
        "participants.userId": userId,
    };
}

function touch(now: Date) {
    return { $set: touched(now), ...bump };
}

function touched(now: Date) {
    return { lastActivityAt: now, updatedAt: now };
}

export default fp(
    async function (fastify: FastifyInstance) {
        if (!fastify.mongo.db) {
            throw new Error("MongoDB is not connected");
        }

        fastify.decorate(
            "pokerRoomsRepository",
            new PokerRoomsRepository(
                fastify.mongo as Required<FastifyMongoObject>,
            ),
        );
    },
    {
        name: "poker-rooms-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
