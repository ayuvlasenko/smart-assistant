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
    lockTtlMilliseconds?: number;
    lockMaxHoldMilliseconds?: number;
}

export interface TelegramSessionIndexMatch {
    userId: number;
    entry: string;
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
            maxHoldMilliseconds: options.lockMaxHoldMilliseconds ?? 60_000,
        };
    }

    async withSession<T>(
        botId: string,
        userId: number,
        handle: (session: TelegramSession, signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        const sessionKey = sessionKeyOf(botId, userId);
        await using lock = await this.lockService.acquire(
            `${sessionKey}:lock`,
            this.lockOptions,
        );
        const session = new TelegramSession(this.cache, sessionKey);
        let result: T;

        try {
            result = await handle(session, lock.signal);
        } catch (err) {
            await this.save(lock, botId, userId, session).catch(
                (saveErr: unknown) => {
                    throw new AggregateError(
                        [err, saveErr],
                        "Telegram update failed and its session was not saved",
                    );
                },
            );
            throw err;
        }

        await this.save(lock, botId, userId, session);

        return result;
    }

    async findIndexed(
        botId: string,
        name: string,
    ): Promise<TelegramSessionIndexMatch[]> {
        const members = await this.cache.getExpiringSetMembers(
            indexKeyOf(botId, name),
        );

        return members.flatMap((member) => {
            const separator = member.indexOf(":");
            const userId = Number(member.slice(0, separator));

            return separator > 0 && Number.isSafeInteger(userId)
                ? [{ userId, entry: member.slice(separator + 1) }]
                : [];
        });
    }

    private async save(
        lock: Lock,
        botId: string,
        userId: number,
        session: TelegramSession,
    ): Promise<void> {
        if (!session.hasChanges) {
            return;
        }

        const { fields, indexes } = session.collectChanges();
        const isSaved = await this.cache.updateHash(
            session.key,
            {
                ...fields,
                expiringSets: indexes.map(({ name, adds, removals }) => ({
                    key: indexKeyOf(botId, name),
                    adds: adds.map(({ entry, expiresAt }) => ({
                        member: `${userId}:${entry}`,
                        expiresAt,
                    })),
                    removals: removals.map((entry) => `${userId}:${entry}`),
                })),
            },
            { ifEquals: this.lockService.heldCondition(lock) },
        );

        if (!isSaved) {
            throw new LockLostError(lockName);
        }
    }
}

function sessionKeyOf(botId: string, userId: number): string {
    return `telegram:${botId}:session:${userId}`;
}

function indexKeyOf(botId: string, name: string): string {
    return `telegram:${botId}:index:${name}`;
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
