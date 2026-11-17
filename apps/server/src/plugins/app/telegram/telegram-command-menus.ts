import { BotCommand } from "@grammyjs/types";
import { Type } from "@sinclair/typebox";
import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { CacheService } from "../cache-service.js";
import {
    defaultLanguage,
    I18nService,
    Language,
    languages,
    Translate,
} from "../i18n-service.js";
import { buildUserWithoutGrants, UserEntity } from "../users/user-entity.js";
import { languageOf } from "../users/user-language.js";
import { UsersEvents } from "../users/users-events.js";
import { UsersRepository } from "../users/users-repository.js";
import { TelegramBot, TelegramBots } from "./telegram-bots.js";
import { TelegramApiError } from "./telegram-errors.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { TelegramRouter } from "./telegram-router.js";

interface TelegramBotMenu {
    languageCode?: Language;
    commands: BotCommand[];
}

const botMenuHashTtlMilliseconds = 30 * 24 * 60 * 60 * 1000;

export class TelegramCommandMenus {
    private readonly log: FastifyBaseLogger;
    private readonly telegramBots: TelegramBots;
    private readonly telegramRouter: TelegramRouter;
    private readonly usersRepository: UsersRepository;
    private readonly cache: CacheService;
    private readonly i18nService: I18nService;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly config: Pick<Env, "ENVIRONMENT">;

    constructor(
        log: FastifyBaseLogger,
        telegramBots: TelegramBots,
        telegramRouter: TelegramRouter,
        usersRepository: UsersRepository,
        cache: CacheService,
        i18nService: I18nService,
        telegramMetrics: TelegramMetrics,
        config: Pick<Env, "ENVIRONMENT">,
    ) {
        this.log = log;
        this.telegramBots = telegramBots;
        this.telegramRouter = telegramRouter;
        this.usersRepository = usersRepository;
        this.cache = cache;
        this.i18nService = i18nService;
        this.telegramMetrics = telegramMetrics;
        this.config = config;
    }

    async setOnStart(): Promise<void> {
        if (this.config.ENVIRONMENT === "preview") {
            return;
        }

        for (const bot of await this.listBotsOnStart()) {
            try {
                await this.syncBot(bot);
            } catch (err) {
                this.log.error(
                    { err, botId: bot.id },
                    "Failed to set the commands of a bot on start",
                );
            }
        }
    }

    async refresh(bot: TelegramBot): Promise<void> {
        const menus = await this.buildBotMenus(bot);

        await this.cache.delete(botMenuKeyOf(bot));

        for (const { languageCode, commands } of menus) {
            const result = await bot.api.setMyCommands({
                commands,
                ...(languageCode ? { language_code: languageCode } : {}),
            });

            if (!result.ok) {
                throw new TelegramApiError("setMyCommands", result);
            }
        }

        await this.cache.set(botMenuKeyOf(bot), hashMenus(bot, menus), {
            ttlMilliseconds: botMenuHashTtlMilliseconds,
        });
        this.log.info(
            {
                botId: bot.id,
                commands: menus[0]?.commands.map(({ command }) => command),
            },
            "Telegram commands set successfully",
        );
    }

    async syncBot(bot: TelegramBot): Promise<void> {
        const hash = await this.cache.get(botMenuKeyOf(bot), Type.String());

        if (hash !== hashMenus(bot, await this.buildBotMenus(bot))) {
            await this.refresh(bot);
        }
    }

    async syncUser(user: UserEntity): Promise<void> {
        const bot = await this.telegramBots.find(user.botId);

        if (bot) {
            await this.sync(bot, user);
        }
    }

    async sync(bot: TelegramBot, user: UserEntity): Promise<void> {
        if (user.isBanned) {
            return;
        }

        const [commands, defaultCommands] = await Promise.all([
            this.describeCommandsOf(
                user,
                this.i18nService.getT(languageOf(user)),
            ),
            this.describeCommandsOf(
                buildUserWithoutGrants(user.botId),
                this.i18nService.getT(user.languageCode),
            ),
        ]);
        const commandMenu = isDeepStrictEqual(commands, defaultCommands)
            ? undefined
            : hashMenus(bot, [{ commands }]);

        if (commandMenu === user.commandMenu) {
            this.telegramMetrics.recordCommandMenuSync("unchanged");
            return;
        }

        try {
            await this.setChatMenu(
                bot,
                Number(user.telegramId),
                commandMenu ? commands : undefined,
            );
            await this.usersRepository.setCommandMenu(user._id, commandMenu);
            this.telegramMetrics.recordCommandMenuSync(
                commandMenu ? "set" : "removed",
            );
            this.log.info(
                {
                    botId: bot.id,
                    userId: user._id,
                    commands: commandMenu
                        ? commands.map(({ command }) => command)
                        : undefined,
                },
                commandMenu
                    ? "Telegram chat commands set successfully"
                    : "Telegram chat commands removed",
            );
        } catch (err) {
            this.telegramMetrics.recordCommandMenuSync("failed");
            this.log.error(
                { err, botId: bot.id, userId: user._id },
                "Failed to set telegram chat commands",
            );
        }
    }

    private async listBotsOnStart(): Promise<TelegramBot[]> {
        try {
            return await this.telegramBots.list();
        } catch (err) {
            this.log.error({ err }, "Failed to read the bots on start");
            return [];
        }
    }

    private buildBotMenus(bot: TelegramBot): Promise<TelegramBotMenu[]> {
        const user = buildUserWithoutGrants(bot.id);

        return Promise.all(
            [undefined, ...languages].map(async (languageCode) => ({
                languageCode,
                commands: await this.describeCommandsOf(
                    user,
                    this.i18nService.getT(languageCode ?? defaultLanguage),
                ),
            })),
        );
    }

    private async describeCommandsOf(
        user: UserEntity,
        t: Translate,
    ): Promise<BotCommand[]> {
        const commands: BotCommand[] = [];

        for (const route of this.telegramRouter.listCommands()) {
            if (await isAllowed(route.guard, user)) {
                commands.push({
                    command: route.name,
                    description: route.description(t),
                });
            }
        }

        return commands;
    }

    private async setChatMenu(
        bot: TelegramBot,
        chatId: number,
        commands: BotCommand[] | undefined,
    ): Promise<void> {
        const scope = { type: "chat", chat_id: chatId } as const;

        if (commands) {
            const result = await bot.api.setMyCommands({ commands, scope });

            if (!result.ok) {
                throw new TelegramApiError("setMyCommands", result);
            }

            return;
        }

        const result = await bot.api.deleteMyCommands({ scope });

        if (!result.ok) {
            throw new TelegramApiError("deleteMyCommands", result);
        }
    }
}

function hashMenus(bot: TelegramBot, menus: TelegramBotMenu[]): string {
    return createHash("sha256")
        .update(JSON.stringify({ telegramId: bot.telegramId, menus }))
        .digest("base64url");
}

function botMenuKeyOf(bot: TelegramBot): string {
    return `telegram:${bot.telegramId}:commands:menu`;
}

export default fp(
    async function (fastify: FastifyInstance) {
        const telegramCommandMenus = new TelegramCommandMenus(
            fastify
                .getDecorator<AppLogger>("appLogger")
                .child({ module: "telegram" }),
            fastify.getDecorator<TelegramBots>("telegramBots"),
            fastify.getDecorator<TelegramRouter>("telegramRouter"),
            fastify.getDecorator<UsersRepository>("usersRepository"),
            fastify.getDecorator<CacheService>("cache"),
            fastify.getDecorator<I18nService>("i18nService"),
            fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
            fastify.getDecorator<Env>("config"),
        );

        fastify.decorate("telegramCommandMenus", telegramCommandMenus);

        fastify
            .getDecorator<Emittery<UsersEvents>>("eventEmitter")
            .on("users.accessChanged", ({ data }) =>
                telegramCommandMenus.syncUser(data.user),
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
            "users-repository",
        ],
    },
);
