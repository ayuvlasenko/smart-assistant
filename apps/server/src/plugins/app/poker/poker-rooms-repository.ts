import { FastifyMongoObject } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Filter, ObjectId } from "mongodb";
import {
    PokerRoomEntity,
    pokerRoomIdleMilliseconds,
    PokerRoomStatus,
} from "./poker-room-entity.js";
import { PokerRoomPatch } from "./poker-room-transitions.js";

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

    save(
        room: PokerRoomEntity,
        patch: PokerRoomPatch,
        now: Date,
    ): Promise<PokerRoomEntity | null> {
        return this.collection().findOneAndUpdate(
            { _id: room._id, version: room.version },
            {
                $set: { ...patch, lastActivityAt: now, updatedAt: now },
                $inc: { version: 1 },
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
