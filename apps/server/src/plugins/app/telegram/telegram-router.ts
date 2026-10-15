import { Update } from "@grammyjs/types";
import { type TObject } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Translate } from "../i18n-service.js";
import { TelegramContext } from "./telegram-context.js";
import {
    assertTelegramDeepLinkName,
    parseTelegramDeepLink,
} from "./telegram-deep-links.js";
import {
    BannedTelegramUserError,
    UnhandledTelegramUpdateError,
} from "./telegram-errors.js";
import { extractTelegramCommand } from "./telegram-extractors.js";
import {
    GuardedTelegramUpdate,
    TelegramCommandMessageUpdate,
    TelegramUpdateFilter,
} from "./telegram-filters.js";
import { isAllowed, TelegramGuard } from "./telegram-guard.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import { TelegramScene } from "./telegram-scene.js";

const commandNamePattern = /^[a-z0-9_]{1,32}$/;

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

export type TelegramDeepLinkHandler = (
    ctx: TelegramContext<TelegramCommandMessageUpdate>,
    value: string,
) => Promise<unknown>;

export interface TelegramRouteOptions {
    use?: TelegramMiddleware[];
    guard?: TelegramGuard;
}

export interface TelegramCommandOptions extends TelegramRouteOptions {
    description?: TelegramCommandDescription;
}

export interface TelegramDeepLinkOptions extends TelegramRouteOptions {
    allowBanned?: boolean;
}

export interface TelegramCommandInfo {
    name: string;
    description: TelegramCommandDescription;
    guard?: TelegramGuard;
}

interface TelegramRoute {
    middlewares: TelegramMiddleware[];
    handler: TelegramHandler;
    guard?: TelegramGuard;
}

interface TelegramCommandRoute extends TelegramRoute {
    description?: TelegramCommandDescription;
}

interface TelegramMatchRoute extends TelegramRoute {
    matches: TelegramPredicate;
}

interface TelegramDeepLinkRoute {
    middlewares: TelegramMiddleware[];
    handler: TelegramDeepLinkHandler;
    guard?: TelegramGuard;
    allowBanned: boolean;
}

export class TelegramRouter {
    private readonly middlewares: TelegramMiddleware[] = [];
    private readonly commandRoutes = new Map<string, TelegramCommandRoute>();
    private readonly matchRoutes: TelegramMatchRoute[] = [];
    private readonly deepLinkRoutes = new Map<string, TelegramDeepLinkRoute>();
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

        if (!commandNamePattern.test(name)) {
            throw new Error(
                `Telegram command "${name}" must match ${String(commandNamePattern)}`,
            );
        }

        if (this.commandRoutes.has(name)) {
            throw new Error(`Telegram command "${name}" is already registered`);
        }

        this.commandRoutes.set(name, {
            middlewares: options.use ?? [],
            handler: handler as TelegramHandler,
            guard: options.guard,
            description: options.description,
        });
    }

    deepLink(
        name: string,
        handler: TelegramDeepLinkHandler,
        options: TelegramDeepLinkOptions = {},
    ): void {
        this.assertUnlocked();
        assertTelegramDeepLinkName(name);

        if (this.deepLinkRoutes.has(name)) {
            throw new Error(
                `Telegram deep link "${name}" is already registered`,
            );
        }

        this.deepLinkRoutes.set(name, {
            middlewares: options.use ?? [],
            handler,
            guard: options.guard,
            allowBanned: options.allowBanned ?? false,
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
            guard: options.guard,
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
            guard: options.guard,
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
                commands.push({
                    name,
                    description: route.description,
                    guard: route.guard,
                });
            }
        }

        return commands;
    }

    async dispatch(ctx: TelegramContext<Update>): Promise<void> {
        if (ctx.user.isBanned) {
            return this.dispatchBanned(ctx);
        }

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

    private async dispatchBanned(ctx: TelegramContext<Update>): Promise<void> {
        const route = this.findDeepLink(ctx, { bannedOnly: true });

        if (!route) {
            throw new BannedTelegramUserError();
        }

        await runRoute(ctx, route);
    }

    private async route(
        ctx: TelegramContext<Update>,
        next: () => Promise<void>,
    ): Promise<void> {
        const route = await this.findRoute(ctx);

        if (!route) {
            return next();
        }

        await runRoute(ctx, route);
    }

    private async findRoute(
        ctx: TelegramContext<Update>,
    ): Promise<TelegramRoute | undefined> {
        const deepLink = this.findDeepLink(ctx, { bannedOnly: false });

        if (deepLink) {
            return deepLink;
        }

        const command = extractTelegramCommand(ctx.update);
        const commandRoute = command && this.commandRoutes.get(command.name);

        if (commandRoute && isAllowed(commandRoute.guard, ctx.user)) {
            return commandRoute;
        }

        for (const route of this.matchRoutes) {
            if (
                isAllowed(route.guard, ctx.user) &&
                (await route.matches(ctx))
            ) {
                return route;
            }
        }
    }

    private findDeepLink(
        ctx: TelegramContext<Update>,
        { bannedOnly }: { bannedOnly: boolean },
    ): TelegramRoute | undefined {
        const command = extractTelegramCommand(ctx.update);

        const link =
            command?.name === "start"
                ? parseTelegramDeepLink(command.payload)
                : undefined;
        const route = link && this.deepLinkRoutes.get(link.name);

        if (
            !link ||
            !route ||
            (bannedOnly && !route.allowBanned) ||
            !isAllowed(route.guard, ctx.user)
        ) {
            return;
        }

        return {
            middlewares: route.middlewares,
            handler: (routeCtx) =>
                route.handler(
                    routeCtx as TelegramContext<TelegramCommandMessageUpdate>,
                    link.value,
                ),
        };
    }

    private assertUnlocked(): void {
        if (this.isLocked) {
            throw new Error(
                "Telegram routes cannot be registered after the app is ready",
            );
        }
    }
}

async function runRoute(
    ctx: TelegramContext<Update>,
    route: TelegramRoute,
): Promise<void> {
    await runMiddlewares(ctx, route.middlewares, async () => {
        await route.handler(ctx);
    });
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
