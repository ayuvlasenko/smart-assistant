import { FastifyMongoObject } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Document, ObjectId } from "mongodb";
import { SettingEntity } from "./setting-entity.js";

export class SettingsRepository {
    readonly mongo: Required<FastifyMongoObject>;

    constructor(mongo: Required<FastifyMongoObject>) {
        this.mongo = mongo;
    }

    findAll(): Promise<SettingEntity[]> {
        return this.collection().find().toArray();
    }

    async save(
        name: string,
        value: unknown,
        updatedBy: ObjectId,
    ): Promise<void> {
        await this.collection().updateOne(
            { _id: name },
            {
                $set: { value, updatedBy, updatedAt: new Date() },
                $inc: { version: 1 },
            },
            { upsert: true },
        );
    }

    async toggleFlag(
        name: string,
        defaultValue: boolean,
        updatedBy: ObjectId,
    ): Promise<unknown> {
        return this.update(name, updatedBy, {
            $not: [{ $ifNull: ["$value", defaultValue] }],
        });
    }

    async toggleChoice(
        name: string,
        choice: string,
        defaultValue: string[],
        updatedBy: ObjectId,
    ): Promise<unknown> {
        const current = {
            $cond: [{ $isArray: "$value" }, "$value", defaultValue],
        };

        return this.update(name, updatedBy, {
            $cond: [
                { $in: [choice, current] },
                { $setDifference: [current, [choice]] },
                { $concatArrays: [current, [choice]] },
            ],
        });
    }

    private async update(
        name: string,
        updatedBy: ObjectId,
        value: Document,
    ): Promise<unknown> {
        const setting = await this.collection().findOneAndUpdate(
            { _id: name },
            [
                {
                    $set: {
                        value,
                        updatedBy,
                        updatedAt: "$$NOW",
                        version: { $add: [{ $ifNull: ["$version", 0] }, 1] },
                    },
                },
            ],
            { upsert: true, returnDocument: "after" },
        );

        return setting?.value;
    }

    private collection() {
        return this.mongo.db.collection<SettingEntity>("settings");
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        if (!fastify.mongo.db) {
            throw new Error("MongoDB is not connected");
        }

        fastify.decorate(
            "settingsRepository",
            new SettingsRepository(
                fastify.mongo as Required<FastifyMongoObject>,
            ),
        );
    },
    {
        name: "settings-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
