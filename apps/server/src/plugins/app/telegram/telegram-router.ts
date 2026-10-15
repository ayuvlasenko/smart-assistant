import { Update } from "@grammyjs/types";
import { type TObject } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Translate } from "../i18n-service.js";
import { TelegramContext } from "./telegram-context.js";
import { UnhandledTelegramUpdateError } from "./telegram-errors.js";
import { extractTelegramCommand } from "./telegram-extractors.js";
import {
    GuardedTelegramUpdate,
    TelegramCommandMessageUpdate,
    TelegramUpdateFilter,
} from "./telegram-filters.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import { TelegramScene } from "./telegram-scene.js";

export type TelegramMiddleware<TUpdate extends Update = Update> = (
    ctx: TelegramContext<TUpdate>,
    next: () => Promise<void>,
) => Promise<void>;

export type TelegramHandler<TUpdate extends Update = Update> = (
    ctx: TelegramContext<TUpdate>,
) => Promise<unknown>;

export type TelegramPredicate = (
    ctx: TelegramContext<Update>,
) => boolean | Promise<boolean>;

export type TelegramCommandDescription = (t: Translate) => string;

export interface TelegramRouteOptions {
    use?: TelegramMiddleware[];
}

export interface TelegramCommandOptions extends TelegramRouteOptions {
    description?: TelegramCommandDescription;
}

export interface TelegramCommandInfo {
    name: string;
    description: TelegramCommandDescription;
}

interface TelegramRoute {
    middlewares: TelegramMiddleware[];
    handler: TelegramHandler;
}

interface TelegramCommandRoute extends TelegramRoute {
    description?: TelegramCommandDescription;
}

interface TelegramMatchRoute extends TelegramRoute {
    matches: TelegramPredicate;
}

export class TelegramRouter {
    private readonly middlewares: TelegramMiddleware[] = [];
    private readonly commandRoutes = new Map<string, TelegramCommandRoute>();
    private readonly matchRoutes: TelegramMatchRoute[] = [];
    private isLocked = false;
    private readonly sceneEngine: TelegramSceneEngine;

    constructor(sceneEngine: TelegramSceneEngine) {
        this.sceneEngine = sceneEngine;
    }

    use(middleware: TelegramMiddleware): void {
        this.assertUnlocked();
        this.middlewares.push(middleware);
    }

    command(
        name: string,
        handler: TelegramHandler<TelegramCommandMessageUpdate>,
        options: TelegramCommandOptions = {},
    ): void {
        this.assertUnlocked();

        if (this.commandRoutes.has(name)) {
            throw new Error(`Telegram command "${name}" is already registered`);
        }

        this.commandRoutes.set(name, {
            middlewares: options.use ?? [],
            handler: handler as TelegramHandler,
            description: options.description,
        });
    }

    on<TFilter extends TelegramUpdateFilter<Update>>(
        filter: TFilter,
        handler: TelegramHandler<GuardedTelegramUpdate<TFilter>>,
        options: TelegramRouteOptions = {},
    ): void {
        this.assertUnlocked();
        this.matchRoutes.push({
            matches: (ctx) => filter(ctx.update),
            middlewares: options.use ?? [],
            handler: handler as TelegramHandler,
        });
    }

    when(
        predicate: TelegramPredicate,
        handler: TelegramHandler,
        options: TelegramRouteOptions = {},
    ): void {
        this.assertUnlocked();
        this.matchRoutes.push({
            matches: predicate,
            middlewares: options.use ?? [],
            handler,
        });
    }

    scene<TStateSchema extends TObject>(
        scene: TelegramScene<TStateSchema>,
    ): void {
        this.assertUnlocked();
        this.sceneEngine.register(scene);
    }

    lock(): void {
        this.isLocked = true;
    }

    listCommands(): TelegramCommandInfo[] {
        const commands: TelegramCommandInfo[] = [];

        for (const [name, route] of this.commandRoutes) {
            if (route.description) {
                commands.push({ name, description: route.description });
            }
        }

        return commands;
    }

    async dispatch(ctx: TelegramContext<Update>): Promise<void> {
        await runMiddlewares(
            ctx,
            [
                ...this.middlewares,
                (sceneCtx, next) => this.sceneEngine.handle(sceneCtx, next),
                (routeCtx, next) => this.route(routeCtx, next),
            ],
            async () => {
                throw new UnhandledTelegramUpdateError();
            },
        );
    }

    private async route(
        ctx: TelegramContext<Update>,
        next: () => Promise<void>,
    ): Promise<void> {
        const route = await this.findRoute(ctx);

        if (!route) {
            return next();
        }

        await runMiddlewares(ctx, route.middlewares, async () => {
            await route.handler(ctx);
        });
    }

    private async findRoute(
        ctx: TelegramContext<Update>,
    ): Promise<TelegramRoute | undefined> {
        const command = extractTelegramCommand(ctx.update);
        const commandRoute = command && this.commandRoutes.get(command.name);

        if (commandRoute) {
            return commandRoute;
        }

        for (const route of this.matchRoutes) {
            if (await route.matches(ctx)) {
                return route;
            }
        }
    }

    private assertUnlocked(): void {
        if (this.isLocked) {
            throw new Error(
                "Telegram routes cannot be registered after the app is ready",
            );
        }
    }
}

async function runMiddlewares(
    ctx: TelegramContext<Update>,
    middlewares: TelegramMiddleware[],
    last: () => Promise<void>,
): Promise<void> {
    const dispatch = async (index: number): Promise<void> => {
        const middleware = middlewares[index];

        if (!middleware) {
            return last();
        }

        let isNextCalled = false;

        await middleware(ctx, async () => {
            if (isNextCalled) {
                throw new Error("Telegram middleware called next() twice");
            }

            isNextCalled = true;
            await dispatch(index + 1);
        });
    };

    await dispatch(0);
}

export default fp(
    async function (fastify: FastifyInstance) {
        const router = new TelegramRouter(
            fastify.getDecorator<TelegramSceneEngine>("telegramSceneEngine"),
        );

        fastify.decorate("telegramRouter", router);

        fastify.addHook("onReady", () => {
            router.lock();
        });
    },
    {
        name: "telegram-router",
        dependencies: ["telegram-scene-engine"],
    },
);
