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
    telegramUserId: number;
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
        botTelegramId: string,
        telegramUserId: number,
        handle: (session: TelegramSession, signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        const sessionKey = sessionKeyOf(botTelegramId, telegramUserId);
        await using lock = await this.lockService.acquire(
            `${sessionKey}:lock`,
            this.lockOptions,
        );
        const session = new TelegramSession(this.cache, sessionKey);
        let result: T;

        try {
            result = await handle(session, lock.signal);
        } catch (err) {
            await this.save(lock, botTelegramId, telegramUserId, session).catch(
                (saveErr: unknown) => {
                    throw new AggregateError(
                        [err, saveErr],
                        "Telegram update failed and its session was not saved",
                    );
                },
            );
            throw err;
        }

        await this.save(lock, botTelegramId, telegramUserId, session);

        return result;
    }

    async findIndexed(
        botTelegramId: string,
        name: string,
    ): Promise<TelegramSessionIndexMatch[]> {
        const members = await this.cache.getExpiringSetMembers(
            indexKeyOf(botTelegramId, name),
        );

        return members.flatMap((member) => {
            const separator = member.indexOf(":");
            const telegramUserId = Number(member.slice(0, separator));

            return separator > 0 && Number.isSafeInteger(telegramUserId)
                ? [{ telegramUserId, entry: member.slice(separator + 1) }]
                : [];
        });
    }

    private async save(
        lock: Lock,
        botTelegramId: string,
        telegramUserId: number,
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
                    key: indexKeyOf(botTelegramId, name),
                    adds: adds.map(({ entry, expiresAt }) => ({
                        member: `${telegramUserId}:${entry}`,
                        expiresAt,
                    })),
                    removals: removals.map(
                        (entry) => `${telegramUserId}:${entry}`,
                    ),
                })),
            },
            { ifEquals: this.lockService.heldCondition(lock) },
        );

        if (!isSaved) {
            throw new LockLostError(lockName);
        }
    }
}

function sessionKeyOf(botTelegramId: string, telegramUserId: number): string {
    return `telegram:${botTelegramId}:session:${telegramUserId}`;
}

function indexKeyOf(botTelegramId: string, name: string): string {
    return `telegram:${botTelegramId}:index:${name}`;
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
