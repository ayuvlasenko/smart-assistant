import { Update } from "@grammyjs/types";
import { type TObject } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Translate } from "../i18n-service.js";
import { TelegramContext } from "./telegram-context.js";
import {
    assertTelegramDeepLinkName,
    parseTelegramDeepLink,
    TelegramDeepLink,
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
    handler: TelegramDeepLinkHandler;
    guard?: TelegramGuard;
    allowBanned: boolean;
}

interface TelegramDeepLinkMatch {
    link: TelegramDeepLink;
    route: TelegramDeepLinkRoute;
}

interface TelegramRouteMatch {
    route?: TelegramRoute;
    name?: string;
}

const sceneRouteName = "scene";
const matchRouteName = "route";

export class TelegramRouter {
    private readonly commandRoutes = new Map<string, TelegramCommandRoute>();
    private readonly matchRoutes: TelegramMatchRoute[] = [];
    private readonly deepLinkRoutes = new Map<string, TelegramDeepLinkRoute>();
    private isLocked = false;
    private readonly sceneEngine: TelegramSceneEngine;

    constructor(sceneEngine: TelegramSceneEngine) {
        this.sceneEngine = sceneEngine;
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

    async dispatch(ctx: TelegramContext<Update>): Promise<string> {
        if (ctx.user.isBanned) {
            return this.dispatchBanned(ctx);
        }

        let handledBy = sceneRouteName;

        await this.sceneEngine.handle(ctx, async () => {
            const { route, name } = await this.findRoute(ctx);

            if (!route) {
                throw new UnhandledTelegramUpdateError(name);
            }

            handledBy = name ?? matchRouteName;
            await route.handler(ctx);
        });

        return handledBy;
    }

    private async dispatchBanned(
        ctx: TelegramContext<Update>,
    ): Promise<string> {
        const deepLink = this.findDeepLink(ctx);

        if (
            !deepLink?.route.allowBanned ||
            !(await isAllowed(deepLink.route.guard, ctx.user))
        ) {
            throw new BannedTelegramUserError();
        }

        await deepLinkRouteOf(deepLink).handler(ctx);

        return deepLinkNameOf(deepLink);
    }

    private async findRoute(
        ctx: TelegramContext<Update>,
    ): Promise<TelegramRouteMatch> {
        const deepLink = this.findDeepLink(ctx);

        if (deepLink) {
            return {
                name: deepLinkNameOf(deepLink),
                route: (await isAllowed(deepLink.route.guard, ctx.user))
                    ? deepLinkRouteOf(deepLink)
                    : undefined,
            };
        }

        const command = extractTelegramCommand(ctx.update);
        const commandRoute = command && this.commandRoutes.get(command.name);
        const commandName = commandRoute && `command:${command.name}`;

        if (commandRoute && (await isAllowed(commandRoute.guard, ctx.user))) {
            return { name: commandName, route: commandRoute };
        }

        for (const route of this.matchRoutes) {
            if (
                (await isAllowed(route.guard, ctx.user)) &&
                (await route.matches(ctx))
            ) {
                return { route };
            }
        }

        return { name: commandName };
    }

    private findDeepLink(
        ctx: TelegramContext<Update>,
    ): TelegramDeepLinkMatch | undefined {
        const command = extractTelegramCommand(ctx.update);
        const link =
            command?.name === "start"
                ? parseTelegramDeepLink(command.payload)
                : undefined;
        const route = link && this.deepLinkRoutes.get(link.name);

        return link && route ? { link, route } : undefined;
    }

    private assertUnlocked(): void {
        if (this.isLocked) {
            throw new Error(
                "Telegram routes cannot be registered after the app is ready",
            );
        }
    }
}

function deepLinkNameOf({ link }: TelegramDeepLinkMatch): string {
    return `deepLink:${link.name}`;
}

function deepLinkRouteOf({
    link,
    route,
}: TelegramDeepLinkMatch): TelegramRoute {
    return {
        handler: (ctx) =>
            route.handler(
                ctx as TelegramContext<TelegramCommandMessageUpdate>,
                link.value,
            ),
    };
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
