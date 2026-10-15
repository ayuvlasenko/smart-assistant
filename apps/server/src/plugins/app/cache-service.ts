import { type StaticDecode, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { AppLogger } from "./app-logger.js";

const conditionCheck = `
if #KEYS > 1 and redis.call("get", KEYS[2]) ~= ARGV[1] then
    return 0
end
`;

const setScript = `${conditionCheck}
local command = { "set", KEYS[1], ARGV[2], "PX", ARGV[3] }
if ARGV[4] == "1" then
    command[#command + 1] = "NX"
end
if redis.call(unpack(command)) then
    return 1
end
return 0
`;

const expireScript = `${conditionCheck}
return redis.call("pexpire", KEYS[1], ARGV[2])
`;

const deleteScript = `${conditionCheck}
return redis.call("del", KEYS[1])
`;

const updateHashScript = `${conditionCheck}
local writeCount = tonumber(ARGV[2])
local index = 3
for _ = 1, writeCount do
    redis.call("hset", KEYS[1], ARGV[index], ARGV[index + 1])
    redis.call("hpexpire", KEYS[1], ARGV[index + 2], "FIELDS", 1, ARGV[index])
    index = index + 3
end
for removeIndex = index, #ARGV do
    redis.call("hdel", KEYS[1], ARGV[removeIndex])
end
return 1
`;

export interface CacheCondition {
    key: string;
    value: unknown;
}

export interface CacheConditionOptions {
    ifEquals?: CacheCondition;
}

export interface CacheSetOptions extends CacheConditionOptions {
    ttlMilliseconds: number;
    ifMissing?: boolean;
}

export interface CacheHashFieldWrite {
    field: string;
    value: unknown;
    ttlMilliseconds: number;
}

export interface CacheHashUpdate {
    writes: CacheHashFieldWrite[];
    removals: string[];
}

export class CacheService {
    private readonly client: Redis;
    private readonly log: FastifyBaseLogger;

    constructor(client: Redis, log: FastifyBaseLogger) {
        this.client = client;
        this.log = log;
    }

    async get<Schema extends TSchema>(
        key: string,
        schema: Schema,
    ): Promise<StaticDecode<Schema> | undefined> {
        const value = await this.client.get(key);

        if (value === null) {
            return;
        }

        return this.decode(value, schema, async (err) => {
            this.log.warn({ err, cache: { key } }, "Invalid cache value");
            await this.client.del(key);
        });
    }

    async getHashField<Schema extends TSchema>(
        key: string,
        field: string,
        schema: Schema,
    ): Promise<StaticDecode<Schema> | undefined> {
        const value = await this.client.hget(key, field);

        if (value === null) {
            return;
        }

        return this.decode(value, schema, async (err) => {
            this.log.warn(
                { err, cache: { key, field } },
                "Invalid cache value",
            );
            await this.client.hdel(key, field);
        });
    }

    async set(
        key: string,
        value: unknown,
        { ttlMilliseconds, ifMissing = false, ifEquals }: CacheSetOptions,
    ): Promise<boolean> {
        this.assertValidTtl(ttlMilliseconds);

        return this.runConditional(setScript, key, ifEquals, [
            JSON.stringify(value),
            ttlMilliseconds,
            ifMissing ? "1" : "0",
        ]);
    }

    async expire(
        key: string,
        ttlMilliseconds: number,
        { ifEquals }: CacheConditionOptions = {},
    ): Promise<boolean> {
        this.assertValidTtl(ttlMilliseconds);

        return this.runConditional(expireScript, key, ifEquals, [
            ttlMilliseconds,
        ]);
    }

    async delete(
        key: string,
        { ifEquals }: CacheConditionOptions = {},
    ): Promise<boolean> {
        return this.runConditional(deleteScript, key, ifEquals, []);
    }

    async updateHash(
        key: string,
        update: CacheHashUpdate,
        { ifEquals }: CacheConditionOptions = {},
    ): Promise<boolean> {
        for (const write of update.writes) {
            this.assertValidTtl(write.ttlMilliseconds);
        }

        return this.runConditional(updateHashScript, key, ifEquals, [
            update.writes.length,
            ...update.writes.flatMap((write) => [
                write.field,
                JSON.stringify(write.value),
                write.ttlMilliseconds,
            ]),
            ...update.removals,
        ]);
    }

    async remember<Schema extends TSchema>(
        key: string,
        schema: Schema,
        ttlMilliseconds: number,
        load: () => Promise<StaticDecode<Schema>>,
    ): Promise<StaticDecode<Schema>> {
        const cached = await this.get(key, schema);

        if (cached !== undefined) {
            return cached;
        }

        const value = await load();

        await this.set(key, value, { ttlMilliseconds });

        return value;
    }

    private async runConditional(
        script: string,
        key: string,
        condition: CacheCondition | undefined,
        args: (string | number)[],
    ): Promise<boolean> {
        const keys = condition ? [key, condition.key] : [key];
        const result = await this.client.eval(
            script,
            keys.length,
            ...keys,
            condition ? JSON.stringify(condition.value) : "",
            ...args,
        );

        return Number(result) > 0;
    }

    private assertValidTtl(ttlMilliseconds: number): void {
        if (!Number.isInteger(ttlMilliseconds) || ttlMilliseconds <= 0) {
            throw new Error("Cache TTL must be a positive integer");
        }
    }

    private async decode<Schema extends TSchema>(
        value: string,
        schema: Schema,
        dropInvalid: (err: unknown) => Promise<void>,
    ): Promise<StaticDecode<Schema> | undefined> {
        try {
            return Value.Decode(schema, JSON.parse(value));
        } catch (err) {
            await dropInvalid(err);

            return;
        }
    }
}

export default fp(
    async function cachePlugin(fastify: FastifyInstance) {
        const valkey = fastify.getDecorator<Redis>("valkey");
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");
        const cache = new CacheService(
            valkey,
            appLogger.child({ module: "cache" }),
        );

        fastify.decorate("cache", cache);
    },
    {
        name: "cache",
        dependencies: ["@fastify/env", "app-logger", "valkey"],
    },
);
