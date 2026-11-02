import { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { RateLimiter } from "../rate-limiter.js";
import {
    TelegramApiClient,
    TelegramApiService,
} from "./telegram-api-service.js";
import { TelegramMetrics } from "./telegram-metrics.js";

export interface TelegramBotsPluginOptions extends FastifyPluginOptions {
    telegramApiService?: TelegramApiClient;
}

export interface TelegramBot {
    id: string;
    api: TelegramApiClient;
}

export class TelegramBots {
    readonly root: TelegramBot;
    private readonly bots: Map<string, TelegramBot>;

    constructor(root: TelegramBot) {
        this.root = root;
        this.bots = new Map([[root.id, root]]);
    }

    find(botId: string): TelegramBot | undefined {
        return this.bots.get(botId);
    }

    get(botId: string): TelegramBot {
        const bot = this.find(botId);

        if (!bot) {
            throw new Error(`Telegram bot ${botId} is not registered`);
        }

        return bot;
    }

    list(): TelegramBot[] {
        return [...this.bots.values()];
    }
}

export function telegramBotIdOf(token: string): string {
    return token.split(":", 1).join("");
}

export default fp(
    async function (fastify: FastifyInstance, opts: TelegramBotsPluginOptions) {
        const token = fastify.getDecorator<Env>("config").TELEGRAM_BOT_TOKEN;
        const api =
            opts.telegramApiService ??
            new TelegramApiService(
                token,
                fastify
                    .getDecorator<AppLogger>("appLogger")
                    .child({ module: "telegram-api" }),
                fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
                fastify.getDecorator<RateLimiter>("rateLimiter"),
            );

        fastify.decorate(
            "telegramBots",
            new TelegramBots({ id: telegramBotIdOf(token), api }),
        );
    },
    {
        name: "telegram-bots",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "rate-limiter",
            "telegram-metrics",
        ],
    },
);
