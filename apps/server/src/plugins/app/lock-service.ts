import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Histogram } from "prom-client";
import { AppLogger } from "./app-logger.js";
import { CacheCondition, CacheService } from "./cache-service.js";
import { LockTimeoutError } from "./lock-errors.js";
import { MetricsService } from "./metrics-service.js";

export interface Lock {
    key: string;
    token: string;
}

export interface LockOptions {
    name: string;
    ttlMilliseconds: number;
    waitMilliseconds: number;
}

export interface HeldLock extends Lock, AsyncDisposable {}

const retryMilliseconds = 50;
const slowWaitSeconds = 1;

export class LockService {
    private readonly waitDuration: Histogram<"name">;
    private readonly cache: CacheService;
    private readonly log: FastifyBaseLogger;

    constructor(
        cache: CacheService,
        log: FastifyBaseLogger,
        metrics: MetricsService,
    ) {
        this.cache = cache;
        this.log = log;

        this.waitDuration = metrics.histogram({
            name: "lock_wait_seconds",
            help: "Time spent waiting for a lock",
            labelNames: ["name"],
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
        });
    }

    async acquire(key: string, options: LockOptions): Promise<HeldLock> {
        const lock = await this.waitForLock(key, options);
        const renewal = this.renew(lock, options);

        return {
            ...lock,
            [Symbol.asyncDispose]: async () => {
                await renewal[Symbol.asyncDispose]();
                await this.release(lock);
            },
        };
    }

    async tryAcquire(
        key: string,
        ttlMilliseconds: number,
    ): Promise<Lock | undefined> {
        const token = randomUUID();
        const isAcquired = await this.cache.set(key, token, {
            ttlMilliseconds,
            ifMissing: true,
        });

        return isAcquired ? { key, token } : undefined;
    }

    async release(lock: Lock): Promise<void> {
        await this.cache.delete(lock.key, {
            ifEquals: this.heldCondition(lock),
        });
    }

    heldCondition(lock: Lock): CacheCondition {
        return { key: lock.key, value: lock.token };
    }

    private async waitForLock(
        key: string,
        { name, ttlMilliseconds, waitMilliseconds }: LockOptions,
    ): Promise<Lock> {
        const startedAt = performance.now();
        let lock = await this.tryAcquire(key, ttlMilliseconds);

        while (!lock && performance.now() - startedAt < waitMilliseconds) {
            await setTimeout(retryMilliseconds);
            lock = await this.tryAcquire(key, ttlMilliseconds);
        }

        const waitedSeconds = (performance.now() - startedAt) / 1000;
        this.waitDuration.observe({ name }, waitedSeconds);

        if (!lock) {
            throw new LockTimeoutError(name, waitedSeconds);
        }

        if (waitedSeconds >= slowWaitSeconds) {
            this.log.warn({ lock: name, waitedSeconds }, "Lock wait was slow");
        }

        return lock;
    }

    private renew(
        lock: Lock,
        { name, ttlMilliseconds }: LockOptions,
    ): AsyncDisposable {
        let renewal: Promise<unknown> = Promise.resolve();
        const timer = setInterval(() => {
            renewal = this.extend(lock, ttlMilliseconds)
                .then((isExtended) => {
                    if (!isExtended) {
                        this.log.warn({ lock: name }, "Lock was not extended");
                    }
                })
                .catch((err: unknown) => {
                    this.log.warn({ err, lock: name }, "Lock extension failed");
                });
        }, ttlMilliseconds / 3);

        return {
            [Symbol.asyncDispose]: async () => {
                clearInterval(timer);
                await renewal;
            },
        };
    }

    private extend(lock: Lock, ttlMilliseconds: number): Promise<boolean> {
        return this.cache.expire(lock.key, ttlMilliseconds, {
            ifEquals: this.heldCondition(lock),
        });
    }
}

export default fp(
    async function lockPlugin(fastify: FastifyInstance) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");

        fastify.decorate(
            "lockService",
            new LockService(
                fastify.getDecorator<CacheService>("cache"),
                appLogger.child({ module: "lock" }),
                fastify.getDecorator<MetricsService>("metrics"),
            ),
        );
    },
    {
        name: "lock-service",
        dependencies: ["app-logger", "cache", "metrics"],
    },
);
