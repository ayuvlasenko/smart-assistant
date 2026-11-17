import { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { AppLogger } from "../app-logger.js";
import { BotsRegistry, RegisteredBot } from "../bots/bots-registry.js";
import { RateLimiter } from "../rate-limiter.js";
import {
    TelegramApiClient,
    TelegramApiService,
} from "./telegram-api-service.js";
import { TelegramMetrics } from "./telegram-metrics.js";

export type TelegramApiFactory = (token: string) => TelegramApiClient;

export interface TelegramBotsPluginOptions extends FastifyPluginOptions {
    telegramApiService?: TelegramApiClient;
    telegramApiFactory?: TelegramApiFactory;
}

export interface TelegramBot {
    id: string;
    telegramId: string;
    startModule?: string;
    api: TelegramApiClient;
}

interface TelegramBotClient {
    token: string;
    api: TelegramApiClient;
}

export class TelegramBots {
    private readonly registry: BotsRegistry;
    private readonly createApi: TelegramApiFactory;
    private readonly clients = new Map<string, TelegramBotClient>();

    constructor(registry: BotsRegistry, createApi: TelegramApiFactory) {
        this.registry = registry;
        this.createApi = createApi;
    }

    get root(): TelegramBot {
        return this.get(this.registry.rootId);
    }

    find(botId: string): TelegramBot | undefined {
        const bot = this.registry.find(botId);

        return bot ? this.toTelegramBot(bot) : undefined;
    }

    get(botId: string): TelegramBot {
        const bot = this.find(botId);

        if (!bot) {
            throw new Error(`Telegram bot ${botId} is not registered`);
        }

        return bot;
    }

    async load(botId: string): Promise<TelegramBot | undefined> {
        const bot = await this.registry.load(botId);

        return bot ? this.toTelegramBot(bot) : undefined;
    }

    list(): TelegramBot[] {
        return this.registry.list().map((bot) => this.toTelegramBot(bot));
    }

    connect(token: string): TelegramApiClient {
        return this.createApi(token);
    }

    private toTelegramBot(bot: RegisteredBot): TelegramBot {
        let client = this.clients.get(bot.id);

        if (client?.token !== bot.token) {
            client = { token: bot.token, api: this.createApi(bot.token) };
            this.clients.set(bot.id, client);
        }

        return {
            id: bot.id,
            telegramId: bot.telegramId,
            startModule: bot.startModule,
            api: client.api,
        };
    }
}

export default fp(
    async function (fastify: FastifyInstance, opts: TelegramBotsPluginOptions) {
        const registry = fastify.getDecorator<BotsRegistry>("botsRegistry");
        const log = fastify
            .getDecorator<AppLogger>("appLogger")
            .child({ module: "telegram-api" });
        const telegramMetrics =
            fastify.getDecorator<TelegramMetrics>("telegramMetrics");
        const rateLimiter = fastify.getDecorator<RateLimiter>("rateLimiter");
        const createApi: TelegramApiFactory = (token) => {
            if (
                opts.telegramApiService &&
                token === registry.find(registry.rootId)?.token
            ) {
                return opts.telegramApiService;
            }

            return (
                opts.telegramApiFactory?.(token) ??
                new TelegramApiService(token, log, telegramMetrics, rateLimiter)
            );
        };

        fastify.decorate("telegramBots", new TelegramBots(registry, createApi));
    },
    {
        name: "telegram-bots",
        dependencies: [
            "app-logger",
            "bots-registry",
            "rate-limiter",
            "telegram-metrics",
        ],
    },
);
