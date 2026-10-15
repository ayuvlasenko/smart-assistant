import { FastifyMongoObject } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ClientSession, ObjectId } from "mongodb";
import {
    EntityVersionMismatchError,
    NotFoundError,
} from "../../../errors/common-errors.js";
import { UserEntity, UserProfile } from "./user-entity.js";

const optionalProfileFields = ["firstName", "username"] as const;

export class UsersRepository {
    readonly mongo: Required<FastifyMongoObject>;

    constructor(mongo: Required<FastifyMongoObject>) {
        this.mongo = mongo;
    }

    findOneById(
        _id: ObjectId,
        session?: ClientSession,
    ): Promise<UserEntity | null> {
        return this.mongo.db
            .collection<UserEntity>("users")
            .findOne({ _id }, { session });
    }

    findManyByIds(
        ids: ObjectId[],
        session?: ClientSession,
    ): Promise<UserEntity[]> {
        return this.mongo.db
            .collection<UserEntity>("users")
            .find({ _id: { $in: ids } }, { session })
            .toArray();
    }

    async existsWithGrant(
        grant: string,
        session?: ClientSession,
    ): Promise<boolean> {
        const count = await this.mongo.db
            .collection<UserEntity>("users")
            .countDocuments({ grants: grant }, { session, limit: 1 });

        return count > 0;
    }

    findOneByTelegramId(
        telegramId: string,
        session?: ClientSession,
    ): Promise<UserEntity | null> {
        return this.mongo.db
            .collection<UserEntity>("users")
            .findOne({ telegramId }, { session });
    }

    async findOneByTelegramIdOrCreate(
        data: Pick<UserEntity, "telegramId" | "isBanned"> & UserProfile,
        session?: ClientSession,
    ): Promise<UserEntity> {
        return (await this.mongo.db
            .collection<UserEntity>("users")
            .findOneAndUpdate(
                { telegramId: data.telegramId },
                {
                    $setOnInsert: {
                        _id: new ObjectId(),
                        ...withoutUndefined(data),
                        grants: [],
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

    async updateProfile(
        _id: ObjectId,
        profile: UserProfile,
        session?: ClientSession,
    ): Promise<UserEntity> {
        const unset = Object.fromEntries(
            optionalProfileFields
                .filter((field) => profile[field] === undefined)
                .map((field) => [field, ""] as const),
        );
        const user = await this.mongo.db
            .collection<UserEntity>("users")
            .findOneAndUpdate(
                { _id },
                {
                    $set: {
                        ...withoutUndefined(profile),
                        updatedAt: new Date(),
                    },
                    ...(Object.keys(unset).length ? { $unset: unset } : {}),
                    $inc: { version: 1 },
                },
                { session, returnDocument: "after" },
            );

        if (!user) {
            throw new NotFoundError("User");
        }

        return user;
    }

    async grantAccess(
        _id: ObjectId,
        grants: string[],
        session?: ClientSession,
    ): Promise<UserEntity> {
        const user = await this.mongo.db
            .collection<UserEntity>("users")
            .findOneAndUpdate(
                { _id },
                {
                    $set: { isBanned: false, updatedAt: new Date() },
                    $addToSet: { grants: { $each: grants } },
                    $inc: { version: 1 },
                },
                { session, returnDocument: "after" },
            );

        if (!user) {
            throw new NotFoundError("User");
        }

        return user;
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
            throw new EntityVersionMismatchError("User");
        }
    }
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined),
    ) as Partial<T>;
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
