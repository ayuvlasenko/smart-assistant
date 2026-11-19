import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Collection, Document, ObjectId } from "mongodb";
import { readMongoDb } from "../../external/mongo.js";
import { SettingEntity } from "./setting-entity.js";

export class SettingsRepository {
    private readonly settings: Collection<SettingEntity>;

    constructor(settings: Collection<SettingEntity>) {
        this.settings = settings;
    }

    findOne(botId: string, name: string): Promise<SettingEntity | null> {
        return this.settings.findOne({ botId, name });
    }

    async save(
        botId: string,
        name: string,
        value: unknown,
        updatedBy: ObjectId,
    ): Promise<void> {
        await this.settings.updateOne(
            { botId, name },
            {
                $set: { value, updatedBy, updatedAt: new Date() },
                $inc: { version: 1 },
            },
            { upsert: true },
        );
    }

    async toggleFlag(
        botId: string,
        name: string,
        defaultValue: boolean,
        updatedBy: ObjectId,
    ): Promise<unknown> {
        return this.update(botId, name, updatedBy, {
            $not: [{ $ifNull: ["$value", defaultValue] }],
        });
    }

    async toggleChoice(
        botId: string,
        name: string,
        choice: string,
        defaultValue: string[],
        updatedBy: ObjectId,
    ): Promise<unknown> {
        const current = {
            $cond: [{ $isArray: "$value" }, "$value", defaultValue],
        };

        return this.update(botId, name, updatedBy, {
            $cond: [
                { $in: [choice, current] },
                { $setDifference: [current, [choice]] },
                { $concatArrays: [current, [choice]] },
            ],
        });
    }

    private async update(
        botId: string,
        name: string,
        updatedBy: ObjectId,
        value: Document,
    ): Promise<unknown> {
        const setting = await this.settings.findOneAndUpdate(
            { botId, name },
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
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "settingsRepository",
            new SettingsRepository(
                readMongoDb(fastify).collection<SettingEntity>("settings"),
            ),
        );
    },
    {
        name: "settings-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
