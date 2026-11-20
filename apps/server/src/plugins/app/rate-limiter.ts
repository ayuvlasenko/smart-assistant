import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { defineValkeyScript, ValkeyScript } from "../external/kv-valkey.js";
import {
    RateLimitGrant,
    RateLimitQueue,
    RateLimitTake,
} from "./rate-limit-queue.js";

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
const ownClassName = "own";

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

const takeLua = `${tokenBucketFunctions}
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

const takeSharedLua = `${tokenBucketFunctions}
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

const pauseLua = `${tokenBucketFunctions}
local now = currentTime()
local rate = tonumber(ARGV[1]) / 1000
local burst = tonumber(ARGV[2])
local tokens = refill(KEYS[1], rate, burst, now)
store(KEYS[1], math.min(tokens, 1 - tonumber(ARGV[3]) * rate), rate, burst, now)
return 1
`;

export class RateLimiter {
    private readonly podId = randomUUID();
    private readonly queues = new Map<string, RateLimitQueue>();
    private readonly takeScript: ValkeyScript;
    private readonly takeSharedScript: ValkeyScript;
    private readonly pauseScript: ValkeyScript;

    constructor(client: Redis) {
        this.takeScript = defineValkeyScript(client, "rateLimitTake", takeLua);
        this.takeSharedScript = defineValkeyScript(
            client,
            "rateLimitTakeShared",
            takeSharedLua,
        );
        this.pauseScript = defineValkeyScript(
            client,
            "rateLimitPause",
            pauseLua,
        );
    }

    acquire(
        bucket: RateLimitBucket,
        { className, signal }: RateLimitAcquireOptions,
    ): Promise<number> {
        return this.queueOf(bucket).acquire(
            bucket.shares ? className : ownClassName,
            signal,
        );
    }

    async pause(
        bucket: RateLimitBucket,
        delayMilliseconds: number,
    ): Promise<void> {
        await this.pauseScript(
            [bucket.key],
            [bucket.ratePerSecond, bucket.burst, delayMilliseconds],
        );
    }

    private queueOf(bucket: RateLimitBucket): RateLimitQueue {
        const existing = this.queues.get(bucket.key);

        if (existing) {
            return existing;
        }

        const shares = bucket.shares && Object.entries(bucket.shares);
        const take: RateLimitTake = shares
            ? (waitingClasses) =>
                  this.takeShared(bucket, shares, waitingClasses)
            : (waitingClasses) => this.takeOwn(bucket, waitingClasses);
        const queue = new RateLimitQueue(
            shares ? shares.map(([className]) => className) : [ownClassName],
            take,
            () => this.queues.delete(bucket.key),
        );

        this.queues.set(bucket.key, queue);

        return queue;
    }

    private async takeOwn(
        bucket: RateLimitBucket,
        waitingClasses: Set<string>,
    ): Promise<RateLimitGrant> {
        if (waitingClasses.size === 0) {
            return { className: undefined, waitMilliseconds: 0 };
        }

        const waitMilliseconds = Number(
            await this.takeScript(
                [bucket.key],
                [bucket.ratePerSecond, bucket.burst],
            ),
        );

        return waitMilliseconds <= 0
            ? { className: ownClassName, waitMilliseconds: 0 }
            : { className: undefined, waitMilliseconds };
    }

    private async takeShared(
        bucket: RateLimitBucket,
        shares: [string, number][],
        waitingClasses: Set<string>,
    ): Promise<RateLimitGrant> {
        const result = (await this.takeSharedScript(
            [
                bucket.key,
                ...shares.map(
                    ([className]) => `${bucket.key}:class:${className}`,
                ),
                ...shares.map(
                    ([className]) => `${bucket.key}:waiting:${className}`,
                ),
            ],
            [
                bucket.ratePerSecond,
                bucket.burst,
                waitingTtlMilliseconds,
                shares.length,
                this.podId,
                ...shares.flatMap(([className, share]) => [
                    share,
                    waitingClasses.has(className) ? "1" : "0",
                ]),
            ],
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
