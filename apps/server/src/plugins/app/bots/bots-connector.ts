import { WebhookInfo } from "@grammyjs/types";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AppLogger } from "../app-logger.js";
import { TelegramBotService } from "../telegram/telegram-bot-service.js";
import { TelegramBot, TelegramBots } from "../telegram/telegram-bots.js";
import { TelegramCommandMenus } from "../telegram/telegram-command-menus.js";
import { isBotToken } from "./bot-entity.js";

export interface BotProfile {
    telegramId: string;
    username: string;
}

export class BotsConnector {
    private readonly telegramBots: TelegramBots;
    private readonly telegramBotService: TelegramBotService;
    private readonly telegramCommandMenus: TelegramCommandMenus;
    private readonly log: FastifyBaseLogger;

    constructor(
        telegramBots: TelegramBots,
        telegramBotService: TelegramBotService,
        telegramCommandMenus: TelegramCommandMenus,
        log: FastifyBaseLogger,
    ) {
        this.telegramBots = telegramBots;
        this.telegramBotService = telegramBotService;
        this.telegramCommandMenus = telegramCommandMenus;
        this.log = log;
    }

    async isServed(botId: string): Promise<boolean> {
        return (await this.telegramBots.find(botId)) !== undefined;
    }

    async readProfile(token: string): Promise<BotProfile | undefined> {
        if (!isBotToken(token)) {
            return undefined;
        }

        const result = await this.telegramBots.connect(token).getMe();

        return result.ok
            ? {
                  telegramId: String(result.result.id),
                  username: result.result.username,
              }
            : undefined;
    }

    async readWebhook(botId: string): Promise<WebhookInfo | undefined> {
        const bot = await this.telegramBots.find(botId);

        if (!bot) {
            return undefined;
        }

        try {
            return await this.telegramBotService.readWebhook(bot);
        } catch (err) {
            this.log.warn(
                { err, botId },
                "Failed to read the webhook of a bot",
            );
            return undefined;
        }
    }

    async connect(botId: string): Promise<void> {
        const bot = await this.telegramBots.find(botId);

        if (!bot) {
            return;
        }

        try {
            await this.telegramBotService.setWebhook(bot);
            await this.telegramCommandMenus.refresh(bot);
        } catch (err) {
            this.log.error(
                { err, botId },
                "Failed to connect the webhook of a bot",
            );
        }
    }

    find(botId: string): Promise<TelegramBot | undefined> {
        return this.telegramBots.find(botId);
    }

    async disconnect(botId: string): Promise<void> {
        const bot = await this.telegramBots.find(botId);

        if (bot) {
            await this.deleteWebhook(bot);
        }
    }

    async deleteWebhook(bot: TelegramBot): Promise<void> {
        try {
            await this.telegramBotService.deleteWebhook(bot);
        } catch (err) {
            this.log.warn(
                { err, botId: bot.id },
                "Failed to delete the webhook of a bot",
            );
        }
    }

    refreshCommands(botId: string): Promise<void> {
        return this.telegramCommandMenus.syncBotById(botId);
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "botsConnector",
            new BotsConnector(
                fastify.getDecorator<TelegramBots>("telegramBots"),
                fastify.getDecorator<TelegramBotService>("telegramBotService"),
                fastify.getDecorator<TelegramCommandMenus>(
                    "telegramCommandMenus",
                ),
                fastify
                    .getDecorator<AppLogger>("appLogger")
                    .child({ module: "bots" }),
            ),
        );
    },
    {
        name: "bots-connector",
        dependencies: [
            "app-logger",
            "telegram-bot-service",
            "telegram-bots",
            "telegram-command-menus",
        ],
    },
);
