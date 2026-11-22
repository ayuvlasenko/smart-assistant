import { BotCommand } from "@grammyjs/types";
import { Type } from "@sinclair/typebox";
import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AppLogger } from "../app-logger.js";
import { CacheService } from "../cache-service.js";
import {
    defaultLanguage,
    I18nService,
    Language,
    languages,
    Translate,
} from "../i18n-service.js";
import { LockOptions, LockService } from "../lock-service.js";
import { UserEntity } from "../users/user-entity.js";
import { languageOf } from "../users/user-language.js";
import { UsersEvents } from "../users/users-events.js";
import { UsersRepository } from "../users/users-repository.js";
import { UsersService } from "../users/users-service.js";
import { TelegramMethodArgs } from "./telegram-api-service.js";
import { TelegramBot, TelegramBots } from "./telegram-bots.js";
import { unwrapTelegramResponse } from "./telegram-errors.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { TelegramRouter } from "./telegram-router.js";
import { TelegramStartEntries } from "./telegram-start-entries.js";

interface TelegramBotMenu {
    languageCode?: Language;
    commands: BotCommand[];
}

type TelegramMenuTarget = NonNullable<
    TelegramMethodArgs<"deleteMyCommands">[0]
>;

const botMenuHashTtlMilliseconds = 30 * 24 * 60 * 60 * 1000;
const botMenuLockOptions: LockOptions = {
    name: "telegram_bot_menu",
    ttlMilliseconds: 30_000,
    maxHoldMilliseconds: 5 * 60 * 1000,
};

export class TelegramCommandMenus {
    private readonly log: FastifyBaseLogger;
    private readonly telegramBots: TelegramBots;
    private readonly telegramRouter: TelegramRouter;
    private readonly telegramStartEntries: TelegramStartEntries;
    private readonly usersRepository: UsersRepository;
    private readonly usersService: UsersService;
    private readonly cache: CacheService;
    private readonly lockService: LockService;
    private readonly i18nService: I18nService;
    private readonly telegramMetrics: TelegramMetrics;

    constructor(
        log: FastifyBaseLogger,
        telegramBots: TelegramBots,
        telegramRouter: TelegramRouter,
        telegramStartEntries: TelegramStartEntries,
        usersRepository: UsersRepository,
        usersService: UsersService,
        cache: CacheService,
        lockService: LockService,
        i18nService: I18nService,
        telegramMetrics: TelegramMetrics,
    ) {
        this.log = log;
        this.telegramBots = telegramBots;
        this.telegramRouter = telegramRouter;
        this.telegramStartEntries = telegramStartEntries;
        this.usersRepository = usersRepository;
        this.usersService = usersService;
        this.cache = cache;
        this.lockService = lockService;
        this.i18nService = i18nService;
        this.telegramMetrics = telegramMetrics;
    }

    async refresh(bot: TelegramBot): Promise<void> {
        await this.withBotMenuLock(bot, (current, menus) =>
            this.setBotMenus(current, menus),
        );
    }

    async syncBot(bot: TelegramBot): Promise<void> {
        await this.withBotMenuLock(bot, async (current, menus) => {
            const hash = await this.cache.get(
                botMenuKeyOf(current),
                Type.String(),
            );

            if (hash !== hashMenus(current, menus)) {
                await this.setBotMenus(current, menus);
            }
        });
    }

    async syncBotById(botId: string): Promise<void> {
        const bot = await this.telegramBots.find(botId);

        if (!bot) {
            return;
        }

        try {
            await this.syncBot(bot);
        } catch (err) {
            this.log.error(
                { err, botId },
                "Failed to refresh the commands of a bot",
            );
        }
    }

    async syncUser(user: UserEntity): Promise<void> {
        try {
            const bot = await this.telegramBots.find(user.botId);

            if (bot) {
                await this.sync(bot, user);
            }
        } catch (err) {
            this.recordChatMenuFailure(err, user);
        }
    }

    async sync(bot: TelegramBot, user: UserEntity): Promise<void> {
        try {
            await this.syncChatMenu(bot, user);
        } catch (err) {
            this.recordChatMenuFailure(err, user);
        }
    }

    private async syncChatMenu(
        bot: TelegramBot,
        user: UserEntity,
    ): Promise<void> {
        const newcomer = await this.usersService.buildNewcomer(user.botId);
        const [commands, defaultCommands] = await Promise.all([
            this.describeCommandsOf(
                bot,
                user,
                this.i18nService.getT(languageOf(user)),
            ),
            this.describeCommandsOf(
                bot,
                newcomer,
                this.i18nService.getT(user.languageCode),
            ),
        ]);
        const commandMenu =
            user.isBanned || isDeepStrictEqual(commands, defaultCommands)
                ? undefined
                : hashMenus(bot, [{ commands }]);

        if (commandMenu === user.commandMenu) {
            this.telegramMetrics.recordCommandMenuSync("unchanged");
            return;
        }

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
    }

    private recordChatMenuFailure(err: unknown, user: UserEntity): void {
        this.telegramMetrics.recordCommandMenuSync("failed");
        this.log.error(
            { err, botId: user.botId, userId: user._id },
            "Failed to set telegram chat commands",
        );
    }

    private async withBotMenuLock(
        bot: TelegramBot,
        update: (
            current: TelegramBot,
            menus: TelegramBotMenu[],
        ) => Promise<void>,
    ): Promise<void> {
        const lock = await this.lockService.acquire(
            `telegram:${bot.telegramId}:commands:lock`,
            botMenuLockOptions,
        );

        try {
            const current = (await this.telegramBots.find(bot.id)) ?? bot;

            await update(current, await this.buildBotMenus(current));
        } finally {
            await lock[Symbol.asyncDispose]();
        }
    }

    private async setBotMenus(
        bot: TelegramBot,
        menus: TelegramBotMenu[],
    ): Promise<void> {
        await this.cache.delete(botMenuKeyOf(bot));

        for (const { languageCode, commands } of menus) {
            await setMenu(
                bot,
                commands,
                languageCode ? { language_code: languageCode } : {},
            );
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

    private async buildBotMenus(bot: TelegramBot): Promise<TelegramBotMenu[]> {
        const user = await this.usersService.buildNewcomer(bot.id);

        return Promise.all(
            [undefined, ...languages].map(async (languageCode) => ({
                languageCode,
                commands: await this.describeCommandsOf(
                    bot,
                    user,
                    this.i18nService.getT(languageCode ?? defaultLanguage),
                ),
            })),
        );
    }

    private async describeCommandsOf(
        bot: TelegramBot,
        user: UserEntity,
        t: Translate,
    ): Promise<BotCommand[]> {
        if (user.isBanned) {
            return [];
        }

        const startEntry = await this.telegramStartEntries.find(bot, user);
        const commands: BotCommand[] = startEntry
            ? [{ command: "start", description: startEntry.description(t) }]
            : [];

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
        await setMenu(bot, commands ?? [], {
            scope: { type: "chat", chat_id: chatId },
        });
    }
}

async function setMenu(
    bot: TelegramBot,
    commands: BotCommand[],
    target: TelegramMenuTarget,
): Promise<void> {
    if (commands.length) {
        unwrapTelegramResponse(
            "setMyCommands",
            await bot.api.setMyCommands({ commands, ...target }),
        );
        return;
    }

    unwrapTelegramResponse(
        "deleteMyCommands",
        await bot.api.deleteMyCommands(target),
    );
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
            fastify.getDecorator<TelegramStartEntries>("telegramStartEntries"),
            fastify.getDecorator<UsersRepository>("usersRepository"),
            fastify.getDecorator<UsersService>("usersService"),
            fastify.getDecorator<CacheService>("cache"),
            fastify.getDecorator<LockService>("lockService"),
            fastify.getDecorator<I18nService>("i18nService"),
            fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
        );

        fastify.decorate("telegramCommandMenus", telegramCommandMenus);

        fastify
            .getDecorator<Emittery<UsersEvents>>("eventEmitter")
            .on("users.accessChanged", ({ data }) =>
                telegramCommandMenus.syncUser(data.user),
            );
    },
    {
        name: "telegram-command-menus",
        dependencies: [
            "app-logger",
            "cache",
            "emittery",
            "i18n-service",
            "lock-service",
            "telegram-bots",
            "telegram-metrics",
            "telegram-router",
            "telegram-start-entries",
            "users-repository",
            "users-service",
        ],
    },
);
