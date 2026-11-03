import { FastifyMongoObject } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { BotEntity, EncryptedBotToken } from "./bot-entity.js";

export type BotData = Pick<BotEntity, "_id" | "username" | "token"> &
    Partial<Pick<BotEntity, "createdBy">>;

export class BotsRepository {
    readonly mongo: Required<FastifyMongoObject>;

    constructor(mongo: Required<FastifyMongoObject>) {
        this.mongo = mongo;
    }

    findAll(): Promise<BotEntity[]> {
        return this.collection().find().sort({ createdAt: 1 }).toArray();
    }

    findOneById(_id: string): Promise<BotEntity | null> {
        return this.collection().findOne({ _id });
    }

    async ensure(_id: string): Promise<BotEntity> {
        const now = new Date();
        const bot = await this.collection().findOneAndUpdate(
            { _id },
            {
                $setOnInsert: {
                    modules: [],
                    version: 0,
                    createdAt: now,
                    updatedAt: now,
                },
            },
            { upsert: true, returnDocument: "after" },
        );

        if (!bot) {
            throw new Error(`Bot ${_id} was not stored`);
        }

        return bot;
    }

    async createIfMissing(data: BotData): Promise<BotEntity | null> {
        const now = new Date();
        const bot: BotEntity = {
            ...data,
            modules: [],
            version: 0,
            createdAt: now,
            updatedAt: now,
        };
        const result = await this.collection().updateOne(
            { _id: data._id },
            { $setOnInsert: bot },
            { upsert: true },
        );

        return result.upsertedCount ? bot : null;
    }

    updateModules(_id: string, modules: string[]): Promise<BotEntity | null> {
        return this.update(_id, { $set: { modules } });
    }

    updateToken(
        _id: string,
        token: EncryptedBotToken,
        username: string,
    ): Promise<BotEntity | null> {
        return this.update(_id, { $set: { token, username } });
    }

    disable(_id: string, now: Date): Promise<BotEntity | null> {
        return this.update(_id, { $set: { disabledAt: now } });
    }

    enable(_id: string): Promise<BotEntity | null> {
        return this.update(_id, { $unset: { disabledAt: "" } });
    }

    private update(
        _id: string,
        change: { $set: Partial<BotEntity> } | { $unset: { disabledAt: "" } },
    ): Promise<BotEntity | null> {
        return this.collection().findOneAndUpdate(
            { _id },
            {
                ...change,
                $currentDate: { updatedAt: true },
                $inc: { version: 1 },
            },
            { returnDocument: "after" },
        );
    }

    private collection() {
        return this.mongo.db.collection<BotEntity>("bots");
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        if (!fastify.mongo.db) {
            throw new Error("MongoDB is not connected");
        }

        fastify.decorate(
            "botsRepository",
            new BotsRepository(fastify.mongo as Required<FastifyMongoObject>),
        );
    },
    {
        name: "bots-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
