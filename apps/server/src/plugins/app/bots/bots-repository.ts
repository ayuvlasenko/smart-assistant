import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Collection, Filter, MongoServerError, ObjectId } from "mongodb";
import { readMongoDb } from "../../external/mongo.js";
import { BotEntity, EncryptedBotToken, newRootBotId } from "./bot-entity.js";
import { BotTelegramIdTakenError } from "./bots-errors.js";

export type BotData = Pick<BotEntity, "telegramId" | "username" | "token"> &
    Partial<Pick<BotEntity, "createdBy">>;

export interface RootBot {
    bot: BotEntity;
    previousTelegramId?: string;
}

export class BotsRepository {
    private readonly bots: Collection<BotEntity>;

    constructor(bots: Collection<BotEntity>) {
        this.bots = bots;
    }

    findAll(): Promise<BotEntity[]> {
        return this.bots.find().sort({ createdAt: 1 }).toArray();
    }

    findOneById(_id: string): Promise<BotEntity | null> {
        return this.bots.findOne({ _id });
    }

    findOneByTelegramId(telegramId: string): Promise<BotEntity | null> {
        return this.bots.findOne({ telegramId });
    }

    async ensureRoot(telegramId: string): Promise<RootBot> {
        const known = await this.bots.findOneAndUpdate(
            { telegramId },
            { $set: { isRoot: true } },
            { returnDocument: "after" },
        );

        if (known) {
            await this.bots.updateMany(
                { _id: { $ne: known._id }, isRoot: true },
                { $unset: { isRoot: "" } },
            );

            return { bot: known };
        }

        const previous = await this.bots.findOneAndUpdate(
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
        const result = await this.bots.updateOne(
            { telegramId },
            { $setOnInsert: fields },
            { upsert: true },
        );

        return result.upsertedCount ? { ...fields, telegramId } : null;
    }

    toggleModule(_id: string, module: string): Promise<BotEntity | null> {
        return this.bots.findOneAndUpdate(
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
        if (startModule === undefined) {
            return this.update({ _id }, { $unset: { startModule: "" } });
        }

        return this.update(
            { _id, modules: startModule },
            { $set: { startModule } },
        );
    }

    replaceToken(
        _id: string,
        telegramId: string,
        token: EncryptedBotToken,
        username: string,
    ): Promise<BotEntity | null> {
        return this.update({ _id, telegramId }, { $set: { token, username } });
    }

    async moveToTelegramBot(
        _id: string,
        telegramId: string,
        token: EncryptedBotToken,
        username: string,
    ): Promise<BotEntity | null> {
        try {
            return await this.update(
                { _id },
                { $set: { telegramId, token, username } },
            );
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw new BotTelegramIdTakenError(telegramId);
            }

            throw err;
        }
    }

    disable(_id: string, now: Date): Promise<BotEntity | null> {
        return this.update(
            { _id, disabledAt: { $exists: false } },
            { $set: { disabledAt: now } },
        );
    }

    enable(_id: string): Promise<BotEntity | null> {
        return this.update(
            { _id, disabledAt: { $exists: true } },
            { $unset: { disabledAt: "" } },
        );
    }

    private update(
        filter: Filter<BotEntity>,
        change:
            | { $set: Partial<BotEntity> }
            | { $unset: Partial<Record<"disabledAt" | "startModule", "">> },
    ): Promise<BotEntity | null> {
        return this.bots.findOneAndUpdate(
            filter,
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
        const bot = await this.bots.findOneAndUpdate(
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
}

function isDuplicateKeyError(err: unknown): boolean {
    return err instanceof MongoServerError && err.code === 11000;
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "botsRepository",
            new BotsRepository(
                readMongoDb(fastify).collection<BotEntity>("bots"),
            ),
        );
    },
    {
        name: "bots-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
