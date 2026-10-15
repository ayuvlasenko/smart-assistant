import { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { CacheService } from "../cache-service.js";
import { LockLostError } from "../lock-errors.js";
import { Lock, LockOptions, LockService } from "../lock-service.js";
import { TelegramSession } from "./telegram-session.js";

export interface TelegramSessionStorePluginOptions extends FastifyPluginOptions {
    telegramSessionStore?: TelegramSessionStoreOptions;
}

export interface TelegramSessionStoreOptions {
    lockWaitMilliseconds?: number;
    lockTtlMilliseconds?: number;
}

const lockName = "telegram-session";

export class TelegramSessionStore {
    private readonly lockOptions: LockOptions;
    private readonly cache: CacheService;
    private readonly lockService: LockService;

    constructor(
        cache: CacheService,
        lockService: LockService,
        options: TelegramSessionStoreOptions = {},
    ) {
        this.cache = cache;
        this.lockService = lockService;

        this.lockOptions = {
            name: lockName,
            ttlMilliseconds: options.lockTtlMilliseconds ?? 30_000,
            waitMilliseconds: options.lockWaitMilliseconds ?? 10_000,
        };
    }

    async withSession<T>(
        userId: number,
        handle: (session: TelegramSession) => Promise<T>,
    ): Promise<T> {
        const sessionKey = `telegram:session:${userId}`;
        await using lock = await this.lockService.acquire(
            `${sessionKey}:lock`,
            this.lockOptions,
        );
        const session = new TelegramSession(this.cache, sessionKey);
        let result: T;

        try {
            result = await handle(session);
        } catch (err) {
            await this.save(lock, session).catch((saveErr: unknown) => {
                throw new AggregateError(
                    [err, saveErr],
                    "Telegram update failed and its session was not saved",
                );
            });
            throw err;
        }

        await this.save(lock, session);

        return result;
    }

    private async save(lock: Lock, session: TelegramSession): Promise<void> {
        if (!session.hasChanges) {
            return;
        }

        const isSaved = await this.cache.updateHash(
            session.key,
            session.collectChanges(),
            { ifEquals: this.lockService.heldCondition(lock) },
        );

        if (!isSaved) {
            throw new LockLostError(lockName);
        }
    }
}

export default fp(
    async function (
        fastify: FastifyInstance,
        opts: TelegramSessionStorePluginOptions,
    ) {
        fastify.decorate(
            "telegramSessionStore",
            new TelegramSessionStore(
                fastify.getDecorator<CacheService>("cache"),
                fastify.getDecorator<LockService>("lockService"),
                opts.telegramSessionStore,
            ),
        );
    },
    {
        name: "telegram-session-store",
        dependencies: ["cache", "lock-service"],
    },
);
