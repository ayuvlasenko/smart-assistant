import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { RateLimitGrant, RateLimitQueue } from "./rate-limit-queue.js";

export interface RateLimitBucket {
    key: string;
    ratePerSecond: number;
    burst: number;
    shares?: Record<string, number>;
}

export interface RateLimitAcquireOptions {
    className: string;
    signal?: AbortSignal;
}

const waitingTtlMilliseconds = 2_000;

const tokenBucketFunctions = `
local function currentTime()
    local time = redis.call("time")
    return tonumber(time[1]) * 1000 + tonumber(time[2]) / 1000
end

local function refill(key, rate, burst, now)
    local state = redis.call("hmget", key, "tokens", "updatedAt")
    local tokens = tonumber(state[1]) or burst
    local updatedAt = tonumber(state[2]) or now
    return math.min(burst, tokens + (now - updatedAt) * rate)
end

local function store(key, tokens, rate, burst, now)
    redis.call("hset", key, "tokens", tostring(tokens), "updatedAt", tostring(now))
    redis.call("pexpire", key, math.ceil((burst - tokens) / rate) + 1000)
end
`;

const takeScript = `${tokenBucketFunctions}
local now = currentTime()
local rate = tonumber(ARGV[1]) / 1000
local burst = tonumber(ARGV[2])
local tokens = refill(KEYS[1], rate, burst, now)
if tokens >= 1 then
    store(KEYS[1], tokens - 1, rate, burst, now)
    return "0"
end
return tostring((1 - tokens) / rate)
`;

const takeSharedScript = `${tokenBucketFunctions}
local now = currentTime()
local rate = tonumber(ARGV[1]) / 1000
local burst = tonumber(ARGV[2])
local waitingTtl = tonumber(ARGV[3])
local count = tonumber(ARGV[4])
local pod = ARGV[5]
local totalShare = 0
for index = 1, count do
    local waiting = KEYS[1 + count + index]
    if ARGV[5 + index * 2] == "1" then
        redis.call("zadd", waiting, now + waitingTtl, pod)
    else
        redis.call("zrem", waiting, pod)
    end
    redis.call("zremrangebyscore", waiting, "-inf", now)
    if redis.call("zcard", waiting) > 0 then
        totalShare = totalShare + tonumber(ARGV[4 + index * 2])
        redis.call("pexpire", waiting, waitingTtl)
    end
end
local tokens = refill(KEYS[1], rate, burst, now)
local wait = nil
for index = 1, count do
    if ARGV[5 + index * 2] == "1" then
        local classRate = rate * tonumber(ARGV[4 + index * 2]) / totalShare
        local classTokens = refill(KEYS[1 + index], classRate, burst, now)
        if tokens >= 1 and classTokens >= 1 then
            store(KEYS[1], tokens - 1, rate, burst, now)
            store(KEYS[1 + index], classTokens - 1, classRate, burst, now)
            return { index, "0" }
        end
        local classWait = math.max((1 - tokens) / rate, (1 - classTokens) / classRate)
        if wait == nil or classWait < wait then
            wait = classWait
        end
    end
end
return { 0, tostring(wait or 0) }
`;

const pauseScript = `${tokenBucketFunctions}
local now = currentTime()
local rate = tonumber(ARGV[1]) / 1000
local burst = tonumber(ARGV[2])
local tokens = refill(KEYS[1], rate, burst, now)
store(KEYS[1], math.min(tokens, 1 - tonumber(ARGV[3]) * rate), rate, burst, now)
return 1
`;

export class RateLimiter {
    private readonly client: Redis;
    private readonly podId = randomUUID();
    private readonly queues = new Map<string, RateLimitQueue>();

    constructor(client: Redis) {
        this.client = client;
    }

    acquire(
        bucket: RateLimitBucket,
        { className, signal }: RateLimitAcquireOptions,
    ): Promise<number> {
        return bucket.shares
            ? this.queueOf(bucket, bucket.shares).acquire(className, signal)
            : this.acquireOwn(bucket, signal);
    }

    async pause(
        bucket: RateLimitBucket,
        delayMilliseconds: number,
    ): Promise<void> {
        await this.client.eval(
            pauseScript,
            1,
            bucket.key,
            bucket.ratePerSecond,
            bucket.burst,
            delayMilliseconds,
        );
    }

    private async acquireOwn(
        bucket: RateLimitBucket,
        signal: AbortSignal | undefined,
    ): Promise<number> {
        const startedAt = performance.now();

        for (;;) {
            signal?.throwIfAborted();

            const waitMilliseconds = Number(
                await this.client.eval(
                    takeScript,
                    1,
                    bucket.key,
                    bucket.ratePerSecond,
                    bucket.burst,
                ),
            );

            if (waitMilliseconds <= 0) {
                return performance.now() - startedAt;
            }

            await sleep(waitMilliseconds, signal);
        }
    }

    private queueOf(
        bucket: RateLimitBucket,
        shares: Record<string, number>,
    ): RateLimitQueue {
        const existing = this.queues.get(bucket.key);

        if (existing) {
            return existing;
        }

        const queue = new RateLimitQueue(Object.keys(shares), (waiting) =>
            this.takeShared(bucket, Object.entries(shares), waiting),
        );

        this.queues.set(bucket.key, queue);

        return queue;
    }

    private async takeShared(
        bucket: RateLimitBucket,
        shares: [string, number][],
        waitingClasses: Set<string>,
    ): Promise<RateLimitGrant> {
        const keys = [
            bucket.key,
            ...shares.map(([className]) => `${bucket.key}:class:${className}`),
            ...shares.map(
                ([className]) => `${bucket.key}:waiting:${className}`,
            ),
        ];
        const result = (await this.client.eval(
            takeSharedScript,
            keys.length,
            ...keys,
            bucket.ratePerSecond,
            bucket.burst,
            waitingTtlMilliseconds,
            shares.length,
            this.podId,
            ...shares.flatMap(([className, share]) => [
                share,
                waitingClasses.has(className) ? "1" : "0",
            ]),
        )) as [number, string];
        const [index, waitMilliseconds] = result;

        return {
            className: shares[index - 1]?.[0],
            waitMilliseconds: Math.min(
                Number(waitMilliseconds),
                waitingTtlMilliseconds / 2,
            ),
        };
    }
}

async function sleep(
    milliseconds: number,
    signal: AbortSignal | undefined,
): Promise<void> {
    try {
        await delay(milliseconds, undefined, { signal });
    } catch (err) {
        signal?.throwIfAborted();
        throw err;
    }
}

export default fp(
    async function rateLimiterPlugin(fastify: FastifyInstance) {
        fastify.decorate(
            "rateLimiter",
            new RateLimiter(fastify.getDecorator<Redis>("valkey")),
        );
    },
    {
        name: "rate-limiter",
        dependencies: ["valkey"],
    },
);
