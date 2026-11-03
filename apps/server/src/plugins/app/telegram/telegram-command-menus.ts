import { BotCommand } from "@grammyjs/types";
import { Type } from "@sinclair/typebox";
import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { createHash, randomUUID } from "node:crypto";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { CacheService } from "../cache-service.js";
import {
    defaultLanguage,
    I18nService,
    languages,
    Translate,
} from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersEvents } from "../users/users-events.js";
import { TelegramMethodArgs } from "./telegram-api-service.js";
import { TelegramBot, TelegramBots } from "./telegram-bots.js";
import { TelegramApiError } from "./telegram-errors.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { TelegramCommandInfo, TelegramRouter } from "./telegram-router.js";

const telegramChatCommandsCacheTtlMilliseconds = 24 * 60 * 60 * 1000;
const telegramCommandsGenerationTtlMilliseconds = 30 * 24 * 60 * 60 * 1000;

export class TelegramCommandMenus {
    private readonly log: FastifyBaseLogger;
    private readonly telegramBots: TelegramBots;
    private readonly telegramRouter: TelegramRouter;
    private readonly cache: CacheService;
    private readonly i18nService: I18nService;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly config: Pick<Env, "ENVIRONMENT">;

    constructor(
        log: FastifyBaseLogger,
        telegramBots: TelegramBots,
        telegramRouter: TelegramRouter,
        cache: CacheService,
        i18nService: I18nService,
        telegramMetrics: TelegramMetrics,
        config: Pick<Env, "ENVIRONMENT">,
    ) {
        this.log = log;
        this.telegramBots = telegramBots;
        this.telegramRouter = telegramRouter;
        this.cache = cache;
        this.i18nService = i18nService;
        this.telegramMetrics = telegramMetrics;
        this.config = config;
    }

    async setOnStart(): Promise<void> {
        if (this.config.ENVIRONMENT === "preview") {
            return;
        }

        for (const bot of this.telegramBots.list()) {
            try {
                await this.setDefaults(bot);
            } catch (err) {
                this.log.error(
                    { err, botId: bot.id },
                    "Failed to set the commands of a bot on start",
                );
            }
        }
    }

    async refresh(bot: TelegramBot): Promise<void> {
        await this.setDefaults(bot);
        await this.cache.set(generationKeyOf(bot), randomUUID(), {
            ttlMilliseconds: telegramCommandsGenerationTtlMilliseconds,
        });
    }

    async sync(user: UserEntity): Promise<void> {
        const bot = this.telegramBots.find(user.botId);

        if (user.isBanned || !bot) {
            return;
        }

        const commands = describeCommands(
            this.telegramRouter
                .listCommands()
                .filter(({ guard }) => isAllowed(guard, user)),
            this.i18nService.getT(user.languageCode),
        );
        const key = `telegram:${bot.id}:commands:${user.telegramId}`;

        try {
            const generation = await this.cache.get(
                generationKeyOf(bot),
                Type.String(),
            );
            const hash = createHash("sha256")
                .update(JSON.stringify({ generation, commands }))
                .digest("base64url");

            if ((await this.cache.get(key, Type.String())) === hash) {
                this.telegramMetrics.recordCommandMenuSync("unchanged");
                return;
            }

            await this.set(bot, {
                commands,
                scope: { type: "chat", chat_id: Number(user.telegramId) },
            });
            await this.cache.set(key, hash, {
                ttlMilliseconds: telegramChatCommandsCacheTtlMilliseconds,
            });
            this.telegramMetrics.recordCommandMenuSync("set");

            this.log.info(
                {
                    botId: bot.id,
                    userId: user._id,
                    commands: commands.map(({ command }) => command),
                },
                "Telegram chat commands set successfully",
            );
        } catch (err) {
            this.telegramMetrics.recordCommandMenuSync("failed");
            this.log.error(
                { err, botId: bot.id, userId: user._id },
                "Failed to set telegram chat commands",
            );
        }
    }

    private async setDefaults(bot: TelegramBot): Promise<void> {
        const commands = this.telegramRouter
            .listCommands()
            .filter(({ guard }) => !guard);

        for (const languageCode of [undefined, ...languages]) {
            await this.set(bot, {
                commands: describeCommands(
                    commands,
                    this.i18nService.getT(languageCode ?? defaultLanguage),
                ),
                ...(languageCode ? { language_code: languageCode } : {}),
            });
        }

        this.log.info(
            { botId: bot.id, commands: commands.map(({ name }) => name) },
            "Telegram commands set successfully",
        );
    }

    private async set(
        bot: TelegramBot,
        ...args: TelegramMethodArgs<"setMyCommands">
    ): Promise<void> {
        const result = await bot.api.setMyCommands(...args);

        if (!result.ok) {
            throw new TelegramApiError("setMyCommands", result);
        }
    }
}

function describeCommands(
    commands: TelegramCommandInfo[],
    t: Translate,
): BotCommand[] {
    return commands.map(({ name, description }) => ({
        command: name,
        description: description(t),
    }));
}

function generationKeyOf(bot: TelegramBot): string {
    return `telegram:${bot.id}:commands:generation`;
}

export default fp(
    async function (fastify: FastifyInstance) {
        const telegramCommandMenus = new TelegramCommandMenus(
            fastify
                .getDecorator<AppLogger>("appLogger")
                .child({ module: "telegram" }),
            fastify.getDecorator<TelegramBots>("telegramBots"),
            fastify.getDecorator<TelegramRouter>("telegramRouter"),
            fastify.getDecorator<CacheService>("cache"),
            fastify.getDecorator<I18nService>("i18nService"),
            fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
            fastify.getDecorator<Env>("config"),
        );

        fastify.decorate("telegramCommandMenus", telegramCommandMenus);

        fastify
            .getDecorator<Emittery<UsersEvents>>("eventEmitter")
            .on("users.accessChanged", ({ data }) =>
                telegramCommandMenus.sync(data.user),
            );

        fastify.addHook("onListen", async () => {
            await telegramCommandMenus.setOnStart();
        });
    },
    {
        name: "telegram-command-menus",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "cache",
            "emittery",
            "i18n-service",
            "telegram-bots",
            "telegram-metrics",
            "telegram-router",
        ],
    },
);
