import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { TelegramBots } from "./telegram-bots.js";
import { TelegramContext } from "./telegram-context.js";
import { TelegramCommandMessageUpdate } from "./telegram-filters.js";
import { isAllowed, TelegramGuard } from "./telegram-guard.js";

export type TelegramStartHandler = (
    ctx: TelegramContext<TelegramCommandMessageUpdate>,
) => Promise<unknown>;

export interface TelegramStartEntryOptions {
    guard?: TelegramGuard;
}

interface TelegramStartEntry {
    handler: TelegramStartHandler;
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
        options: TelegramStartEntryOptions = {},
    ): void {
        if (this.entries.has(module)) {
            throw new Error(
                `Telegram start entry of the module "${module}" is already registered`,
            );
        }

        this.entries.set(module, { handler, guard: options.guard });
    }

    listModules(): string[] {
        return [...this.entries.keys()];
    }

    async open(
        ctx: TelegramContext<TelegramCommandMessageUpdate>,
    ): Promise<boolean> {
        const module = this.telegramBots.find(ctx.user.botId)?.startModule;
        const entry =
            module === undefined ? undefined : this.entries.get(module);

        if (!entry || !isAllowed(entry.guard, ctx.user)) {
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
