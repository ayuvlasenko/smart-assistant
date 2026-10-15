import { Update } from "@grammyjs/types";
import { type Static, type TObject } from "@sinclair/typebox";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../schemas/env.js";
import { isTimeZone } from "../../../utils/parsers.js";
import { AppLogger } from "../app-logger.js";
import { I18nService } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { TelegramApiClient } from "./telegram-api-service.js";
import { TelegramContext } from "./telegram-context.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { TelegramResponder } from "./telegram-responder.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import { TelegramScene, TelegramSceneControl } from "./telegram-scene.js";
import { TelegramSessionStore } from "./telegram-session-store.js";

export interface TelegramChatOptions {
    userId: number;
    user: UserEntity;
    log: FastifyBaseLogger;
}

export interface TelegramUpdateOptions extends TelegramChatOptions {
    update: Update;
    responder: TelegramResponder;
}

export interface TelegramSceneTarget {
    userId: number;
    key: string;
}

export type TelegramDeliveryHandler<TState> = (
    ctx: TelegramContext,
    scene: TelegramSceneControl<TState>,
) => Promise<unknown>;

type ErasedDeliveryHandler = TelegramDeliveryHandler<Record<string, unknown>>;

export class TelegramChats {
    private readonly pendingDeliveries = new Set<Promise<void>>();
    private readonly sessionStore: TelegramSessionStore;
    private readonly sceneEngine: TelegramSceneEngine;
    private readonly usersRepository: UsersRepository;
    private readonly i18nService: I18nService;
    private readonly telegramApiService: TelegramApiClient;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly log: FastifyBaseLogger;
    private readonly config: Pick<Env, "TIME_ZONE">;

    constructor(
        sessionStore: TelegramSessionStore,
        sceneEngine: TelegramSceneEngine,
        usersRepository: UsersRepository,
        i18nService: I18nService,
        telegramApiService: TelegramApiClient,
        telegramMetrics: TelegramMetrics,
        log: FastifyBaseLogger,
        config: Pick<Env, "TIME_ZONE">,
    ) {
        const timeZone = config.TIME_ZONE;

        if (!isTimeZone(timeZone)) {
            throw new Error(`TIME_ZONE "${timeZone}" is not a valid time zone`);
        }

        this.sessionStore = sessionStore;
        this.sceneEngine = sceneEngine;
        this.usersRepository = usersRepository;
        this.i18nService = i18nService;
        this.telegramApiService = telegramApiService;
        this.telegramMetrics = telegramMetrics;
        this.log = log;
        this.config = config;
    }

    withUpdate<T>(
        { update, responder, ...chat }: TelegramUpdateOptions,
        handle: (ctx: TelegramContext<Update>) => Promise<T>,
    ): Promise<T> {
        return this.withContext(chat, update, responder, handle);
    }

    deliver<TStateSchema extends TObject>(
        scene: TelegramScene<TStateSchema>,
        targets: TelegramSceneTarget[],
        handle?: TelegramDeliveryHandler<Static<TStateSchema>>,
    ): void {
        const delivery = this.deliverAll(scene, targets, handle);

        this.pendingDeliveries.add(delivery);
        void delivery.finally(() => this.pendingDeliveries.delete(delivery));
    }

    async idle(): Promise<void> {
        while (this.pendingDeliveries.size) {
            await Promise.all(this.pendingDeliveries);
        }
    }

    private async deliverAll(
        scene: TelegramScene,
        targets: TelegramSceneTarget[],
        handle: ErasedDeliveryHandler | undefined,
    ): Promise<void> {
        const results = await Promise.allSettled(
            targets.map((target) => this.deliverTo(scene, target, handle)),
        );

        results.forEach((result, index) => {
            if (result.status === "rejected") {
                this.telegramMetrics.recordSceneEvent(
                    scene.name,
                    "delivery_failed",
                );
                this.log.error(
                    {
                        err: result.reason,
                        scene: scene.name,
                        telegramUserId: targets[index]?.userId,
                    },
                    "Failed to deliver a scene update",
                );
            }
        });
    }

    private async deliverTo(
        scene: TelegramScene,
        target: TelegramSceneTarget,
        handle: ErasedDeliveryHandler | undefined,
    ): Promise<void> {
        const user = await this.usersRepository.findOneByTelegramId(
            String(target.userId),
        );

        if (!user || user.isBanned) {
            return;
        }

        const log = this.log.child({
            telegramUserId: target.userId,
            scene: scene.name,
        });

        await this.withChat({ userId: target.userId, user, log }, (ctx) =>
            this.sceneEngine.deliver(ctx, scene, target.key, async (control) =>
                handle?.(ctx, control),
            ),
        );
    }

    private withChat<T>(
        chat: TelegramChatOptions,
        handle: (ctx: TelegramContext<undefined>) => Promise<T>,
    ): Promise<T> {
        const responder = new TelegramResponder(
            chat.userId,
            undefined,
            this.telegramApiService,
            chat.log,
        );

        return this.withContext(chat, undefined, responder, handle);
    }

    private withContext<TUpdate extends Update | undefined, T>(
        { userId, user, log }: TelegramChatOptions,
        update: TUpdate,
        responder: TelegramResponder,
        handle: (ctx: TelegramContext<TUpdate>) => Promise<T>,
    ): Promise<T> {
        return this.sessionStore.withSession(userId, (session) => {
            const ctx = new TelegramContext({
                update,
                user,
                session,
                log,
                t: this.i18nService.getT(user.languageCode),
                timeZone: user.timeZone ?? this.config.TIME_ZONE,
                responder,
            });

            return this.sceneEngine.withScenes(ctx, () => handle(ctx));
        });
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");
        const telegramChats = new TelegramChats(
            fastify.getDecorator<TelegramSessionStore>("telegramSessionStore"),
            fastify.getDecorator<TelegramSceneEngine>("telegramSceneEngine"),
            fastify.getDecorator<UsersRepository>("usersRepository"),
            fastify.getDecorator<I18nService>("i18nService"),
            fastify.getDecorator<TelegramApiClient>("telegramApiService"),
            fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
            appLogger.child({ module: "telegram" }),
            fastify.config,
        );

        fastify.decorate("telegramChats", telegramChats);
        fastify.addHook("onClose", () => telegramChats.idle());
    },
    {
        name: "telegram-chats",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "i18n-service",
            "telegram-api-service",
            "telegram-metrics",
            "telegram-scene-engine",
            "telegram-session-store",
            "users-repository",
        ],
    },
);
