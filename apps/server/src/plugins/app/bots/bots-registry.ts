import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../env.js";
import { AccessService } from "../access/access-service.js";
import { AppLogger } from "../app-logger.js";
import {
    BotEntity,
    EncryptedBotToken,
    telegramIdOfToken,
} from "./bot-entity.js";
import { BotTokenCipher } from "./bot-token-cipher.js";
import { BotsRepository } from "./bots-repository.js";

export interface RegisteredBot {
    id: string;
    telegramId: string;
    token: string;
    modules: readonly string[];
    startModule?: string;
}

export const botsModule = "bots";

export class BotsRegistry {
    private readonly rootToken: string;
    private readonly botsRepository: BotsRepository;
    private readonly cipher: BotTokenCipher | undefined;
    private readonly log: FastifyBaseLogger;
    private startedRootId: string | undefined;

    constructor(
        botsRepository: BotsRepository,
        cipher: BotTokenCipher | undefined,
        rootToken: string,
        log: FastifyBaseLogger,
    ) {
        this.botsRepository = botsRepository;
        this.cipher = cipher;
        this.rootToken = rootToken;
        this.log = log;
    }

    get rootId(): string {
        if (this.startedRootId === undefined) {
            throw new Error("The bots registry is not started");
        }

        return this.startedRootId;
    }

    get canStoreTokens(): boolean {
        return this.cipher !== undefined;
    }

    async find(botId: string): Promise<RegisteredBot | undefined> {
        const bot = await this.botsRepository.findOneById(botId);

        return bot ? this.register(bot) : undefined;
    }

    async findByTelegramId(
        telegramId: string,
    ): Promise<RegisteredBot | undefined> {
        const bot = await this.botsRepository.findOneByTelegramId(telegramId);

        return bot ? this.register(bot) : undefined;
    }

    async list(): Promise<RegisteredBot[]> {
        const bots = await this.botsRepository.findAll();

        return bots.flatMap((bot) => this.register(bot) ?? []);
    }

    async modulesOf(botId: string): Promise<readonly string[]> {
        const bot = await this.botsRepository.findOneById(botId);

        return bot ? this.listModules(bot) : [];
    }

    encrypt(token: string): EncryptedBotToken {
        if (!this.cipher) {
            throw new Error("BOTS_ENCRYPTION_KEY is not set");
        }

        return this.cipher.encrypt(token);
    }

    async start(): Promise<void> {
        const { bot, previousTelegramId } =
            await this.botsRepository.ensureRoot(
                telegramIdOfToken(this.rootToken),
            );

        this.startedRootId = bot._id;

        if (previousTelegramId) {
            this.log.warn(
                {
                    botId: bot._id,
                    telegramId: bot.telegramId,
                    previousTelegramId,
                },
                "Root bot moved to another Telegram bot",
            );
        }

        this.log.info(
            {
                bots: (await this.list()).map(({ id, modules }) => ({
                    botId: id,
                    modules,
                })),
            },
            "Bots loaded",
        );
    }

    private register(bot: BotEntity): RegisteredBot | undefined {
        if (bot._id === this.startedRootId) {
            return {
                id: bot._id,
                telegramId: telegramIdOfToken(this.rootToken),
                token: this.rootToken,
                modules: this.listModules(bot),
                startModule: bot.startModule,
            };
        }

        if (bot.disabledAt || !bot.token) {
            return undefined;
        }

        const token = this.decrypt(bot._id, bot.token);

        if (token && telegramIdOfToken(token) !== bot.telegramId) {
            this.log.error(
                { botId: bot._id },
                "Bot token belongs to another bot",
            );
            return undefined;
        }

        return token
            ? {
                  id: bot._id,
                  telegramId: bot.telegramId,
                  token,
                  modules: bot.modules,
                  startModule: bot.startModule,
              }
            : undefined;
    }

    private listModules(bot: BotEntity): readonly string[] {
        return bot._id === this.startedRootId
            ? [...bot.modules, botsModule]
            : bot.modules;
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
