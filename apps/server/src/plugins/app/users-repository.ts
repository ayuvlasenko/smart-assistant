import { FastifyMongoObject } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ClientSession, ObjectId } from "mongodb";
import { UserEntity } from "../../types/entities/user-entity.js";

export class UsersRepository {
    constructor(public readonly mongo: Required<FastifyMongoObject>) {}

    findOneByTelegramId(
        telegramId: string,
        session?: ClientSession,
    ): Promise<UserEntity | null> {
        return this.mongo.db
            .collection<UserEntity>("users")
            .findOne({ telegramId }, { session });
    }

    async findOneByTelegramIdOrCreate(
        data: Pick<UserEntity, "telegramId" | "isBanned">,
        session?: ClientSession,
    ): Promise<UserEntity> {
        return (await this.mongo.db
            .collection<UserEntity>("users")
            .findOneAndUpdate(
                { telegramId: data.telegramId },
                {
                    $setOnInsert: {
                        _id: new ObjectId(),
                        ...data,
                        version: 0,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                },
                {
                    session,
                    upsert: true,
                    returnDocument: "after",
                },
            )) as UserEntity;
    }

    findOneById(
        _id: ObjectId,
        session?: ClientSession,
    ): Promise<UserEntity | null> {
        return this.mongo.db
            .collection<UserEntity>("users")
            .findOne({ _id }, { session });
    }

    async findOneByIdOrFail(
        _id: ObjectId,
        session?: ClientSession,
    ): Promise<UserEntity> {
        const user = await this.findOneById(_id, session);

        if (!user) {
            throw new Error("User not found");
        }

        return user;
    }

    async unban(_id: ObjectId, session?: ClientSession): Promise<void> {
        await this.mongo.db.collection<UserEntity>("users").updateOne(
            { _id },
            {
                $set: { isBanned: false, updatedAt: new Date() },
                $inc: { version: 1 },
            },
            { session },
        );
    }

    async save(entity: UserEntity, session?: ClientSession): Promise<void> {
        const { _id, version, ...document } = entity;
        const result = await this.mongo.db
            .collection<UserEntity>("users")
            .updateOne(
                { _id, version },
                {
                    $set: { ...document, updatedAt: new Date() },
                    $inc: { version: 1 },
                },
                { session },
            );

        if (result.matchedCount === 0) {
            throw new Error("User version mismatch");
        }
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        if (!fastify.mongo.db) {
            throw new Error("MongoDB is not connected");
        }

        fastify.decorate(
            "usersRepository",
            new UsersRepository(fastify.mongo as Required<FastifyMongoObject>),
        );
    },
    {
        name: "users-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
