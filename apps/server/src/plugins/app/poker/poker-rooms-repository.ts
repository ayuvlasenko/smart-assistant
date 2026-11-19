import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Collection, Filter, ObjectId } from "mongodb";
import { readMongoDb } from "../../external/mongo.js";
import {
    PokerRoomEntity,
    pokerRoomIdleMilliseconds,
    PokerRoomStatus,
} from "./poker-room-entity.js";
import { NewPokerRoom, PokerRoomPatch } from "./poker-room-transitions.js";

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
    private readonly rooms: Collection<PokerRoomEntity>;

    constructor(rooms: Collection<PokerRoomEntity>) {
        this.rooms = rooms;
    }

    async create(data: NewPokerRoom, now: Date): Promise<PokerRoomEntity> {
        const room: PokerRoomEntity = {
            _id: new ObjectId(),
            ...data,
            version: 0,
            createdAt: now,
            updatedAt: now,
        };

        await this.rooms.insertOne(room);

        return room;
    }

    findOne(filter: Filter<PokerRoomEntity>): Promise<PokerRoomEntity | null> {
        return this.rooms.findOne(filter);
    }

    findOneByToken(
        botId: string,
        token: string,
    ): Promise<PokerRoomEntity | null> {
        return this.rooms.findOne({ botId, token });
    }

    findPage({
        skip,
        limit,
        ...query
    }: PokerRoomsPageOptions): Promise<PokerRoomEntity[]> {
        return this.rooms
            .find(queryFilter(query))
            .sort({ lastActivityAt: -1, _id: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
    }

    count(query: PokerRoomsQuery): Promise<number> {
        return this.rooms.countDocuments(queryFilter(query));
    }

    save(
        room: PokerRoomEntity,
        patch: PokerRoomPatch,
        now: Date,
    ): Promise<PokerRoomEntity | null> {
        return this.rooms.findOneAndUpdate(
            { _id: room._id, version: room.version },
            {
                $set: { ...patch, lastActivityAt: now, updatedAt: now },
                $inc: { version: 1 },
            },
            { returnDocument: "after" },
        );
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
        fastify.decorate(
            "pokerRoomsRepository",
            new PokerRoomsRepository(
                readMongoDb(fastify).collection<PokerRoomEntity>("pokerRooms"),
            ),
        );
    },
    {
        name: "poker-rooms-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
