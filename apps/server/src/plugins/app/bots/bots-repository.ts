import { FastifyMongoObject } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { BotEntity, EncryptedBotToken, newRootBotId } from "./bot-entity.js";

export type BotData = Pick<BotEntity, "telegramId" | "username" | "token"> &
    Partial<Pick<BotEntity, "createdBy">>;

export interface RootBot {
    bot: BotEntity;
    previousTelegramId?: string;
}

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

    findOneByTelegramId(telegramId: string): Promise<BotEntity | null> {
        return this.collection().findOne({ telegramId });
    }

    async ensureRoot(telegramId: string): Promise<RootBot> {
        const known = await this.collection().findOneAndUpdate(
            { telegramId },
            { $set: { isRoot: true } },
            { returnDocument: "after" },
        );

        if (known) {
            await this.collection().updateMany(
                { _id: { $ne: known._id }, isRoot: true },
                { $unset: { isRoot: "" } },
            );

            return { bot: known };
        }

        const previous = await this.collection().findOneAndUpdate(
            { isRoot: true },
            {
                $set: { telegramId },
                $currentDate: { updatedAt: true },
                $inc: { version: 1 },
            },
            { returnDocument: "before" },
        );

        if (previous) {
            return {
                bot: { ...previous, telegramId },
                previousTelegramId: previous.telegramId,
            };
        }

        return { bot: await this.createRoot(telegramId) };
    }

    async createIfMissing({
        telegramId,
        ...data
    }: BotData): Promise<BotEntity | null> {
        const now = new Date();
        const fields = {
            ...data,
            _id: new ObjectId().toHexString(),
            modules: [],
            version: 0,
            createdAt: now,
            updatedAt: now,
        };
        const result = await this.collection().updateOne(
            { telegramId },
            { $setOnInsert: fields },
            { upsert: true },
        );

        return result.upsertedCount ? { ...fields, telegramId } : null;
    }

    updateModules(_id: string, modules: string[]): Promise<BotEntity | null> {
        return this.update(_id, { $set: { modules } });
    }

    toggleModule(_id: string, module: string): Promise<BotEntity | null> {
        return this.collection().findOneAndUpdate(
            { _id },
            [
                {
                    $set: {
                        modules: {
                            $cond: [
                                { $in: [module, "$modules"] },
                                { $setDifference: ["$modules", [module]] },
                                { $concatArrays: ["$modules", [module]] },
                            ],
                        },
                        startModule: {
                            $cond: [
                                {
                                    $and: [
                                        { $in: [module, "$modules"] },
                                        { $eq: ["$startModule", module] },
                                    ],
                                },
                                "$$REMOVE",
                                "$startModule",
                            ],
                        },
                        updatedAt: "$$NOW",
                        version: { $add: ["$version", 1] },
                    },
                },
            ],
            { returnDocument: "after" },
        );
    }

    setStartModule(
        _id: string,
        startModule: string | undefined,
    ): Promise<BotEntity | null> {
        return this.update(
            _id,
            startModule === undefined
                ? { $unset: { startModule: "" } }
                : { $set: { startModule } },
        );
    }

    updateToken(
        _id: string,
        telegramId: string,
        token: EncryptedBotToken,
        username: string,
    ): Promise<BotEntity | null> {
        return this.update(_id, { $set: { telegramId, token, username } });
    }

    disable(_id: string, now: Date): Promise<BotEntity | null> {
        return this.update(_id, { $set: { disabledAt: now } });
    }

    enable(_id: string): Promise<BotEntity | null> {
        return this.update(_id, { $unset: { disabledAt: "" } });
    }

    private update(
        _id: string,
        change:
            | { $set: Partial<BotEntity> }
            | { $unset: Partial<Record<"disabledAt" | "startModule", "">> },
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

    private async createRoot(telegramId: string): Promise<BotEntity> {
        const now = new Date();
        const bot = await this.collection().findOneAndUpdate(
            { _id: newRootBotId },
            {
                $setOnInsert: {
                    telegramId,
                    isRoot: true,
                    modules: [],
                    version: 0,
                    createdAt: now,
                    updatedAt: now,
                },
            },
            { upsert: true, returnDocument: "after" },
        );

        if (!bot) {
            throw new Error("The root bot was not stored");
        }

        return bot;
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
