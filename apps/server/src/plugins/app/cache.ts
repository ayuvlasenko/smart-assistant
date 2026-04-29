import { type StaticDecode, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { buildValkeyKeyPrefix } from "../external/kv-valkey.js";
import { AppLogger } from "./logger.js";

export class CacheService {
    private readonly keyPrefix: string;

    constructor(
        private readonly client: Redis,
        keyPrefix: string,
        private readonly log: FastifyBaseLogger,
    ) {
        if (keyPrefix.endsWith(":")) {
            throw new Error("Cache key prefix must not end with ':'");
        }

        this.keyPrefix = keyPrefix;
    }

    async getJson<Schema extends TSchema>(
        key: string,
        schema: Schema,
    ): Promise<StaticDecode<Schema> | undefined> {
        const resolvedKey = this.resolveKey(key);
        const value = await this.client.get(resolvedKey);

        if (value === null) {
            return;
        }

        let parsed: unknown;

        try {
            parsed = JSON.parse(value);
        } catch (err) {
            await this.deleteInvalidValue(resolvedKey, err);

            return;
        }

        try {
            return Value.Decode(schema, parsed);
        } catch (err) {
            await this.deleteInvalidValue(
                resolvedKey,
                err instanceof Error
                    ? err
                    : new Error("Cached value does not match schema"),
            );

            return;
        }
    }

    async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
        this.assertValidTtl(ttlSeconds);

        await this.client.set(
            this.resolveKey(key),
            JSON.stringify(value),
            "EX",
            ttlSeconds,
        );
    }

    async setJsonIfMissing<T>(
        key: string,
        value: T,
        ttlSeconds: number,
    ): Promise<boolean> {
        this.assertValidTtl(ttlSeconds);

        const result = await this.client.set(
            this.resolveKey(key),
            JSON.stringify(value),
            "EX",
            ttlSeconds,
            "NX",
        );

        return result === "OK";
    }

    async delete(key: string): Promise<void> {
        await this.client.del(this.resolveKey(key));
    }

    async rememberJson<Schema extends TSchema>(
        key: string,
        schema: Schema,
        ttlSeconds: number,
        load: () => Promise<StaticDecode<Schema>>,
    ): Promise<StaticDecode<Schema>> {
        const cached = await this.getJson(key, schema);

        if (cached !== undefined) {
            return cached;
        }

        const value = await load();

        await this.setJson(key, value, ttlSeconds);

        return value;
    }

    private resolveKey(key: string): string {
        return `${this.keyPrefix}:${key.replace(/^:+/, "")}`;
    }

    private assertValidTtl(ttlSeconds: number): void {
        if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
            throw new Error("Cache TTL must be a positive integer");
        }
    }

    private async deleteInvalidValue(key: string, err: unknown): Promise<void> {
        this.log.warn({ err, cache: { key } }, "Invalid cache value");
        await this.client.del(key);
    }
}

export default fp(
    async function cachePlugin(fastify: FastifyInstance) {
        const valkey = fastify.getDecorator<Redis>("valkey");
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");
        const cache = new CacheService(
            valkey,
            buildValkeyKeyPrefix(fastify.config),
            appLogger.child({ module: "cache" }),
        );

        fastify.decorate("cache", cache);
    },
    {
        name: "cache",
        dependencies: ["@fastify/env", "app-logger", "valkey"],
    },
);
