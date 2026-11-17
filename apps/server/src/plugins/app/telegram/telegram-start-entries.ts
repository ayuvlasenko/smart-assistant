import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { UserEntity } from "../users/user-entity.js";
import { TelegramBot, TelegramBots } from "./telegram-bots.js";
import { TelegramContext } from "./telegram-context.js";
import { TelegramCommandMessageUpdate } from "./telegram-filters.js";
import { isAllowed, TelegramGuard } from "./telegram-guard.js";
import { TelegramCommandDescription } from "./telegram-router.js";

export type TelegramStartHandler = (
    ctx: TelegramContext<TelegramCommandMessageUpdate>,
) => Promise<unknown>;

export interface TelegramStartEntryOptions {
    description: TelegramCommandDescription;
    guard?: TelegramGuard;
}

export interface TelegramStartEntry {
    handler: TelegramStartHandler;
    description: TelegramCommandDescription;
    guard?: TelegramGuard;
}

export class TelegramStartEntries {
    private readonly entries = new Map<string, TelegramStartEntry>();
    private readonly telegramBots: TelegramBots;

    constructor(telegramBots: TelegramBots) {
        this.telegramBots = telegramBots;
    }

    register(
        module: string,
        handler: TelegramStartHandler,
        { description, guard }: TelegramStartEntryOptions,
    ): void {
        if (this.entries.has(module)) {
            throw new Error(
                `Telegram start entry of the module "${module}" is already registered`,
            );
        }

        this.entries.set(module, { handler, description, guard });
    }

    listModules(): string[] {
        return [...this.entries.keys()];
    }

    async find(
        bot: TelegramBot,
        user: UserEntity,
    ): Promise<TelegramStartEntry | undefined> {
        const entry =
            bot.startModule === undefined
                ? undefined
                : this.entries.get(bot.startModule);

        return entry && (await isAllowed(entry.guard, user))
            ? entry
            : undefined;
    }

    async open(
        ctx: TelegramContext<TelegramCommandMessageUpdate>,
    ): Promise<boolean> {
        const bot = await this.telegramBots.find(ctx.user.botId);
        const entry = bot && (await this.find(bot, ctx.user));

        if (!entry) {
            return false;
        }

        await entry.handler(ctx);

        return true;
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "telegramStartEntries",
            new TelegramStartEntries(
                fastify.getDecorator<TelegramBots>("telegramBots"),
            ),
        );
    },
    {
        name: "telegram-start-entries",
        dependencies: ["telegram-bots"],
    },
);
