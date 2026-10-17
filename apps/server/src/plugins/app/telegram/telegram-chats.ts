import { Update } from "@grammyjs/types";
import { type Static, type TObject } from "@sinclair/typebox";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { I18nService } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { TelegramApiClient, telegramApiScope } from "./telegram-api-service.js";
import { TelegramContext } from "./telegram-context.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { isTimeZone } from "./telegram-parsers.js";
import { TelegramResponder } from "./telegram-responder.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";
import {
    parseTelegramSceneTopicEntry,
    TelegramSceneRef,
    telegramSceneTopicIndex,
} from "./telegram-scene-storage.js";
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
        this.track(this.deliverAll(scene, targets, handle));
    }

    publish(topics: string[]): void {
        this.track(this.publishAll(topics));
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
        this.telegramMetrics.recordDeliveryRecipients(
            "deliver",
            targets.length,
        );

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
        const finishRecipient =
            this.telegramMetrics.startRecipientDelivery("deliver");

        try {
            await this.withUser(target.userId, { scene: scene.name }, (ctx) =>
                this.sceneEngine.deliver(
                    ctx,
                    scene,
                    target.key,
                    async (control) => handle?.(ctx, control),
                ),
            );
        } finally {
            finishRecipient();
        }
    }

    private async publishAll(topics: string[]): Promise<void> {
        try {
            const watchers = [...(await this.findWatchers(topics))];

            this.telegramMetrics.recordDeliveryRecipients(
                "publish",
                watchers.length,
            );

            const results = await Promise.allSettled(
                watchers.map(([userId, scenes]) =>
                    this.redrawFor(userId, scenes, topics),
                ),
            );

            for (const [index, result] of results.entries()) {
                const [userId, scenes = []] = watchers[index] ?? [];

                if (result.status === "rejected") {
                    this.recordPublishFailure(
                        result.reason,
                        topics,
                        userId,
                        scenes,
                    );
                }
            }
        } catch (err) {
            this.log.error({ err, topics }, "Failed to publish a scene update");
        }
    }

    private async findWatchers(
        topics: string[],
    ): Promise<Map<number, TelegramSceneRef[]>> {
        const entries = new Map<number, Set<string>>();
        const matches = await Promise.all(
            topics.map((topic) =>
                this.sessionStore.findIndexed(telegramSceneTopicIndex(topic)),
            ),
        );

        for (const { userId, entry } of matches.flat()) {
            entries.set(userId, (entries.get(userId) ?? new Set()).add(entry));
        }

        return new Map(
            [...entries].map(([userId, userEntries]) => [
                userId,
                [...userEntries].flatMap(
                    (entry) => parseTelegramSceneTopicEntry(entry) ?? [],
                ),
            ]),
        );
    }

    private async redrawFor(
        userId: number,
        scenes: TelegramSceneRef[],
        topics: string[],
    ): Promise<void> {
        const finishRecipient =
            this.telegramMetrics.startRecipientDelivery("publish");

        try {
            await this.withUser(userId, { topics }, async (ctx) => {
                for (const { sceneId } of scenes) {
                    await this.sceneEngine.redraw(ctx, sceneId, topics);
                }
            });
        } finally {
            finishRecipient();
        }
    }

    private recordPublishFailure(
        err: unknown,
        topics: string[],
        userId: number | undefined,
        scenes: TelegramSceneRef[],
    ): void {
        for (const { sceneName } of scenes) {
            this.telegramMetrics.recordSceneEvent(sceneName, "delivery_failed");
        }

        this.log.error(
            {
                err,
                topics,
                telegramUserId: userId,
                scenes: scenes.map(({ sceneName }) => sceneName),
            },
            "Failed to publish a scene update",
        );
    }

    private track(delivery: Promise<void>): void {
        this.pendingDeliveries.add(delivery);
        void delivery.finally(() => this.pendingDeliveries.delete(delivery));
    }

    private async withUser(
        userId: number,
        bindings: Record<string, unknown>,
        handle: (ctx: TelegramContext<undefined>) => Promise<unknown>,
    ): Promise<void> {
        const user = await this.usersRepository.findOneByTelegramId(
            String(userId),
        );

        if (!user || user.isBanned) {
            return;
        }

        const log = this.log.child({ telegramUserId: userId, ...bindings });

        await this.withChat({ userId, user, log }, handle);
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
        return this.sessionStore.withSession(userId, (session, signal) => {
            const ctx = new TelegramContext({
                update,
                user,
                session,
                log,
                t: this.i18nService.getT(user.languageCode),
                timeZone: user.timeZone ?? this.config.TIME_ZONE,
                responder,
            });

            return telegramApiScope.run(
                {
                    signal,
                    priority:
                        update === undefined ? "background" : "interactive",
                },
                () => this.sceneEngine.withScenes(ctx, () => handle(ctx)),
            );
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
            fastify.getDecorator<Env>("config"),
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
