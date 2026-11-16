import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../env.js";
import { AccessService } from "../access/access-service.js";
import { AppLogger } from "../app-logger.js";
import { BotEntity, botIdOfToken, EncryptedBotToken } from "./bot-entity.js";
import { BotTokenCipher } from "./bot-token-cipher.js";
import { BotsRepository } from "./bots-repository.js";

export interface RegisteredBot {
    id: string;
    token: string;
    modules: readonly string[];
}

export const botsModule = "bots";

const refreshIntervalMilliseconds = 10_000;

export class BotsRegistry {
    readonly rootId: string;
    private readonly rootToken: string;
    private readonly botsRepository: BotsRepository;
    private readonly cipher: BotTokenCipher | undefined;
    private readonly log: FastifyBaseLogger;
    private bots = new Map<string, RegisteredBot>();
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(
        botsRepository: BotsRepository,
        cipher: BotTokenCipher | undefined,
        rootToken: string,
        log: FastifyBaseLogger,
    ) {
        this.botsRepository = botsRepository;
        this.cipher = cipher;
        this.rootToken = rootToken;
        this.rootId = botIdOfToken(rootToken);
        this.log = log;
    }

    get canStoreTokens(): boolean {
        return this.cipher !== undefined;
    }

    find(botId: string): RegisteredBot | undefined {
        return this.bots.get(botId);
    }

    list(): RegisteredBot[] {
        return [...this.bots.values()];
    }

    modulesOf(botId: string): readonly string[] {
        return this.find(botId)?.modules ?? [];
    }

    encrypt(token: string): EncryptedBotToken {
        if (!this.cipher) {
            throw new Error("BOTS_ENCRYPTION_KEY is not set");
        }

        return this.cipher.encrypt(token);
    }

    async load(botId: string): Promise<RegisteredBot | undefined> {
        const known = this.find(botId);

        if (known) {
            return known;
        }

        const bot = await this.botsRepository.findOneById(botId);

        if (bot) {
            this.put(bot);
        }

        return this.find(botId);
    }

    put(bot: BotEntity): void {
        const registered = this.register(bot);

        if (registered) {
            this.bots.set(bot._id, registered);
        } else {
            this.bots.delete(bot._id);
        }
    }

    async start(): Promise<void> {
        await this.botsRepository.ensure(this.rootId);
        await this.refresh();
    }

    async refresh(): Promise<void> {
        const bots = new Map<string, RegisteredBot>();

        for (const bot of await this.botsRepository.findAll()) {
            const registered = this.register(bot);

            if (registered) {
                bots.set(bot._id, registered);
            }
        }

        this.bots = bots;
    }

    startRefresh(): void {
        this.refreshTimer = setInterval(() => {
            this.refresh().catch((err: unknown) => {
                this.log.error({ err }, "Failed to refresh bots");
            });
        }, refreshIntervalMilliseconds);
        this.refreshTimer.unref();
    }

    stopRefresh(): void {
        clearInterval(this.refreshTimer);
    }

    private register(bot: BotEntity): RegisteredBot | undefined {
        if (bot._id === this.rootId) {
            return {
                id: bot._id,
                token: this.rootToken,
                modules: [...bot.modules, botsModule],
            };
        }

        if (bot.disabledAt || !bot.token) {
            return undefined;
        }

        const token = this.decrypt(bot._id, bot.token);

        if (token && botIdOfToken(token) !== bot._id) {
            this.log.error(
                { botId: bot._id },
                "Bot token belongs to another bot",
            );
            return undefined;
        }

        return token ? { id: bot._id, token, modules: bot.modules } : undefined;
    }

    private decrypt(
        botId: string,
        token: EncryptedBotToken,
    ): string | undefined {
        if (!this.cipher) {
            this.log.error(
                { botId },
                "Bot token can't be decrypted without BOTS_ENCRYPTION_KEY",
            );
            return undefined;
        }

        try {
            return this.cipher.decrypt(token);
        } catch (err) {
            this.log.error({ err, botId }, "Bot token can't be decrypted");
            return undefined;
        }
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const config = fastify.getDecorator<Env>("config");
        const registry = new BotsRegistry(
            fastify.getDecorator<BotsRepository>("botsRepository"),
            config.BOTS_ENCRYPTION_KEY
                ? new BotTokenCipher(config.BOTS_ENCRYPTION_KEY)
                : undefined,
            config.TELEGRAM_BOT_TOKEN,
            fastify
                .getDecorator<AppLogger>("appLogger")
                .child({ module: "bots" }),
        );

        await registry.start();

        fastify
            .getDecorator<AccessService>("accessService")
            .useModules((botId) => registry.modulesOf(botId));
        fastify.addHook("onReady", async () => {
            registry.startRefresh();
        });
        fastify.addHook("onClose", async () => {
            registry.stopRefresh();
        });

        fastify.decorate("botsRegistry", registry);
    },
    {
        name: "bots-registry",
        dependencies: [
            "@fastify/env",
            "access-service",
            "app-logger",
            "bots-repository",
        ],
    },
);
