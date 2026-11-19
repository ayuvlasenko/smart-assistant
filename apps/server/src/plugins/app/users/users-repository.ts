import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Collection, ObjectId, UpdateFilter } from "mongodb";
import { readMongoDb } from "../../external/mongo.js";
import { UserEntity, UserProfile } from "./user-entity.js";

const optionalProfileFields = ["firstName", "username"] as const;

export interface UserLookup {
    user: UserEntity;
    isCreated: boolean;
}

export class UsersRepository {
    private readonly users: Collection<UserEntity>;

    constructor(users: Collection<UserEntity>) {
        this.users = users;
    }

    findOneById(_id: ObjectId): Promise<UserEntity | null> {
        return this.users.findOne({ _id });
    }

    findManyByIds(ids: ObjectId[]): Promise<UserEntity[]> {
        return this.users.find({ _id: { $in: ids } }).toArray();
    }

    async existsWithGrant(botId: string, grant: string): Promise<boolean> {
        const count = await this.users.countDocuments(
            { botId, grants: grant },
            { limit: 1 },
        );

        return count > 0;
    }

    findOneByTelegramId(
        botId: string,
        telegramId: string,
    ): Promise<UserEntity | null> {
        return this.users.findOne({ botId, telegramId });
    }

    async findOneByTelegramIdOrCreate(
        data: Pick<UserEntity, "botId" | "telegramId" | "isBanned"> &
            UserProfile,
    ): Promise<UserLookup> {
        const now = new Date();
        const result = await this.users.findOneAndUpdate(
            { botId: data.botId, telegramId: data.telegramId },
            {
                $setOnInsert: {
                    _id: new ObjectId(),
                    ...withoutUndefined(data),
                    grants: [],
                    version: 0,
                    createdAt: now,
                    updatedAt: now,
                },
            },
            {
                upsert: true,
                returnDocument: "after",
                includeResultMetadata: true,
            },
        );

        if (!result.value) {
            throw new Error("The user was not stored");
        }

        return {
            user: result.value,
            isCreated: !result.lastErrorObject?.updatedExisting,
        };
    }

    updateProfile(_id: ObjectId, profile: UserProfile): Promise<UserEntity> {
        const unset = Object.fromEntries(
            optionalProfileFields
                .filter((field) => profile[field] === undefined)
                .map((field) => [field, ""] as const),
        );

        return this.update(_id, {
            $set: { ...withoutUndefined(profile), updatedAt: new Date() },
            ...(Object.keys(unset).length ? { $unset: unset } : {}),
            $inc: { version: 1 },
        });
    }

    grantAccess(_id: ObjectId, grants: string[]): Promise<UserEntity> {
        return this.update(_id, {
            $set: { isBanned: false, updatedAt: new Date() },
            $addToSet: { grants: { $each: grants } },
            $inc: { version: 1 },
        });
    }

    async setCommandMenu(
        _id: ObjectId,
        commandMenu: string | undefined,
    ): Promise<void> {
        await this.users.updateOne(
            { _id },
            {
                ...(commandMenu === undefined
                    ? { $unset: { commandMenu: "" } }
                    : { $set: { commandMenu } }),
                $currentDate: { updatedAt: true },
                $inc: { version: 1 },
            },
        );
    }

    setSetting(
        _id: ObjectId,
        name: string,
        value: unknown,
    ): Promise<UserEntity> {
        const path = `settings.${name}`;

        return this.update(_id, {
            ...(value === undefined
                ? { $unset: { [path]: "" } }
                : { $set: { [path]: value } }),
            $currentDate: { updatedAt: true },
            $inc: { version: 1 },
        });
    }

    private async update(
        _id: ObjectId,
        change: UpdateFilter<UserEntity>,
    ): Promise<UserEntity> {
        const user = await this.users.findOneAndUpdate({ _id }, change, {
            returnDocument: "after",
        });

        if (!user) {
            throw new Error(`User ${_id.toHexString()} is not stored`);
        }

        return user;
    }
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined),
    ) as Partial<T>;
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "usersRepository",
            new UsersRepository(
                readMongoDb(fastify).collection<UserEntity>("users"),
            ),
        );
    },
    {
        name: "users-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
