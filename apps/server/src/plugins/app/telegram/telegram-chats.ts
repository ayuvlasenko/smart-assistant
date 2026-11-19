import { Update } from "@grammyjs/types";
import { type Static, type TObject } from "@sinclair/typebox";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { I18nService } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import { languageOf } from "../users/user-language.js";
import { UsersRepository } from "../users/users-repository.js";
import { telegramApiScope } from "./telegram-api-service.js";
import { TelegramBot, TelegramBots } from "./telegram-bots.js";
import { TelegramContext } from "./telegram-context.js";
import { TelegramDeliveryPermits } from "./telegram-delivery-permits.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { isTimeZone } from "./telegram-parsers.js";
import { telegramDeliveryLimit } from "./telegram-rate-limits.js";
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
    bot: TelegramBot;
    telegramUserId: number;
    user: UserEntity;
    log: FastifyBaseLogger;
}

export interface TelegramUpdateOptions extends TelegramChatOptions {
    update: Update;
    responder: TelegramResponder;
}

export interface TelegramSceneTarget {
    botId: string;
    telegramUserId: number;
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
    private readonly telegramBots: TelegramBots;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly deliveryPermits: TelegramDeliveryPermits;
    private readonly log: FastifyBaseLogger;
    private readonly config: Pick<Env, "TIME_ZONE">;

    constructor(
        sessionStore: TelegramSessionStore,
        sceneEngine: TelegramSceneEngine,
        usersRepository: UsersRepository,
        i18nService: I18nService,
        telegramBots: TelegramBots,
        telegramMetrics: TelegramMetrics,
        deliveryPermits: TelegramDeliveryPermits,
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
        this.telegramBots = telegramBots;
        this.telegramMetrics = telegramMetrics;
        this.deliveryPermits = deliveryPermits;
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

    publish(botId: string, topics: string[]): void {
        this.track(this.publishAll(botId, topics));
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
        const startedAt = performance.now();

        this.telegramMetrics.recordDeliveryRecipients(
            "deliver",
            targets.length,
        );

        const bots = new Map<string, Promise<TelegramBot | undefined>>();
        const results = await Promise.allSettled(
            targets.map((target) => {
                const bot =
                    bots.get(target.botId) ??
                    this.telegramBots.find(target.botId);

                bots.set(target.botId, bot);

                return this.deliverTo(scene, bot, target, handle);
            }),
        );

        this.logDelivery(
            "Scene update delivered",
            { scene: scene.name },
            results,
            startedAt,
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
                        botId: targets[index]?.botId,
                        telegramUserId: targets[index]?.telegramUserId,
                    },
                    "Failed to deliver a scene update",
                );
            }
        });
    }

    private async deliverTo(
        scene: TelegramScene,
        bot: Promise<TelegramBot | undefined>,
        target: TelegramSceneTarget,
        handle: ErasedDeliveryHandler | undefined,
    ): Promise<void> {
        const finishRecipient =
            this.telegramMetrics.startRecipientDelivery("deliver");

        try {
            await this.withUser(
                await bot,
                target.telegramUserId,
                { scene: scene.name },
                (ctx) =>
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

    private async publishAll(botId: string, topics: string[]): Promise<void> {
        const startedAt = performance.now();

        try {
            const bot = await this.telegramBots.find(botId);
            const watchers = [...(await this.findWatchers(bot, topics))];

            this.telegramMetrics.recordDeliveryRecipients(
                "publish",
                watchers.length,
            );

            const results = await Promise.allSettled(
                watchers.map(([telegramUserId, scenes]) =>
                    this.redrawFor(bot, telegramUserId, scenes, topics),
                ),
            );

            this.logDelivery(
                "Scene update published",
                { botId, topics },
                results,
                startedAt,
            );

            for (const [index, result] of results.entries()) {
                const [telegramUserId, scenes = []] = watchers[index] ?? [];

                if (result.status === "rejected") {
                    this.recordPublishFailure(
                        result.reason,
                        botId,
                        topics,
                        telegramUserId,
                        scenes,
                    );
                }
            }
        } catch (err) {
            this.log.error(
                { err, botId, topics },
                "Failed to publish a scene update",
            );
        }
    }

    private async findWatchers(
        bot: TelegramBot | undefined,
        topics: string[],
    ): Promise<Map<number, TelegramSceneRef[]>> {
        const entries = new Map<number, Set<string>>();
        const matches = bot
            ? await Promise.all(
                  topics.map((topic) =>
                      this.sessionStore.findIndexed(
                          bot.telegramId,
                          telegramSceneTopicIndex(topic),
                      ),
                  ),
              )
            : [];

        for (const { telegramUserId, entry } of matches.flat()) {
            entries.set(
                telegramUserId,
                (entries.get(telegramUserId) ?? new Set()).add(entry),
            );
        }

        return new Map(
            [...entries].map(([telegramUserId, userEntries]) => [
                telegramUserId,
                [...userEntries].flatMap(
                    (entry) => parseTelegramSceneTopicEntry(entry) ?? [],
                ),
            ]),
        );
    }

    private async redrawFor(
        bot: TelegramBot | undefined,
        telegramUserId: number,
        scenes: TelegramSceneRef[],
        topics: string[],
    ): Promise<void> {
        const finishRecipient =
            this.telegramMetrics.startRecipientDelivery("publish");

        try {
            await this.withUser(
                bot,
                telegramUserId,
                { topics },
                async (ctx) => {
                    for (const { sceneId } of scenes) {
                        await this.sceneEngine.redraw(ctx, sceneId, topics);
                    }
                },
            );
        } finally {
            finishRecipient();
        }
    }

    private recordPublishFailure(
        err: unknown,
        botId: string,
        topics: string[],
        telegramUserId: number | undefined,
        scenes: TelegramSceneRef[],
    ): void {
        for (const { sceneName } of scenes) {
            this.telegramMetrics.recordSceneEvent(sceneName, "delivery_failed");
        }

        this.log.error(
            {
                err,
                botId,
                topics,
                telegramUserId,
                scenes: scenes.map(({ sceneName }) => sceneName),
            },
            "Failed to publish a scene update",
        );
    }

    private logDelivery(
        message: string,
        fields: Record<string, unknown>,
        results: PromiseSettledResult<void>[],
        startedAt: number,
    ): void {
        if (!results.length) {
            return;
        }

        this.log.info(
            {
                ...fields,
                recipients: results.length,
                failed: results.filter(({ status }) => status === "rejected")
                    .length,
                durationMs: Math.round(performance.now() - startedAt),
            },
            message,
        );
    }

    private track(delivery: Promise<void>): void {
        this.pendingDeliveries.add(delivery);
        void delivery.finally(() => this.pendingDeliveries.delete(delivery));
    }

    private async withUser(
        bot: TelegramBot | undefined,
        telegramUserId: number,
        bindings: Record<string, unknown>,
        handle: (ctx: TelegramContext<undefined>) => Promise<unknown>,
    ): Promise<void> {
        const user =
            bot &&
            (await this.usersRepository.findOneByTelegramId(
                bot.id,
                String(telegramUserId),
            ));

        if (!bot || !user || user.isBanned) {
            return;
        }

        const log = this.log.child({
            botId: bot.id,
            telegramUserId,
            ...bindings,
        });

        await this.withChat({ bot, telegramUserId, user, log }, handle);
    }

    private withChat<T>(
        chat: TelegramChatOptions,
        handle: (ctx: TelegramContext<undefined>) => Promise<T>,
    ): Promise<T> {
        const responder = new TelegramResponder(
            chat.telegramUserId,
            undefined,
            chat.bot.api,
            chat.log,
        );

        return this.deliveryPermits.run(chat.bot.id, () =>
            this.withContext(chat, undefined, responder, handle),
        );
    }

    private withContext<TUpdate extends Update | undefined, T>(
        { bot, telegramUserId, user, log }: TelegramChatOptions,
        update: TUpdate,
        responder: TelegramResponder,
        handle: (ctx: TelegramContext<TUpdate>) => Promise<T>,
    ): Promise<T> {
        return this.sessionStore.withSession(
            bot.telegramId,
            telegramUserId,
            (session, signal) => {
                const ctx = new TelegramContext({
                    bot,
                    update,
                    user,
                    session,
                    log,
                    translatorOf: (current) =>
                        this.i18nService.getT(languageOf(current)),
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
            },
        );
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");
        const i18nService = fastify.getDecorator<I18nService>("i18nService");

        i18nService.addLocales("telegram", telegramLocales);

        const telegramChats = new TelegramChats(
            fastify.getDecorator<TelegramSessionStore>("telegramSessionStore"),
            fastify.getDecorator<TelegramSceneEngine>("telegramSceneEngine"),
            fastify.getDecorator<UsersRepository>("usersRepository"),
            i18nService,
            fastify.getDecorator<TelegramBots>("telegramBots"),
            fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
            new TelegramDeliveryPermits(telegramDeliveryLimit),
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
            "telegram-bots",
            "telegram-metrics",
            "telegram-scene-engine",
            "telegram-session-store",
            "users-repository",
        ],
    },
);
