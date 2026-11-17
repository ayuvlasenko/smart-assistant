import { Update, User } from "@grammyjs/types";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AppLogger } from "../app-logger.js";
import {
    defaultLanguage,
    I18nService,
    Language,
    resolveLanguage,
    Translate,
} from "../i18n-service.js";
import { LockHoldTimeoutError, LockLostError } from "../lock-errors.js";
import { LockService } from "../lock-service.js";
import { UserEntity, UserProfile } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { UsersService } from "../users/users-service.js";
import { TelegramBot } from "./telegram-bots.js";
import { TelegramChats } from "./telegram-chats.js";
import { TelegramCommandMenus } from "./telegram-command-menus.js";
import {
    BannedTelegramUserError,
    DuplicateTelegramUpdateError,
    NonPrivateChatError,
    TelegramApiError,
    TelegramUpdateWithoutUserError,
    UnhandledTelegramUpdateError,
} from "./telegram-errors.js";
import {
    extractTelegramChat,
    extractTelegramUpdateType,
    extractTelegramUser,
} from "./telegram-extractors.js";
import { TelegramMetrics, TelegramUpdateResult } from "./telegram-metrics.js";
import { TelegramResponder } from "./telegram-responder.js";
import { TelegramRouter } from "./telegram-router.js";

interface TelegramUpdateRun {
    bot: TelegramBot;
    update: Update;
    log: FastifyBaseLogger;
    responder: TelegramResponder;
    language: Language;
    route?: string;
    refusedRoute?: string;
}

const updateClaimTtlMilliseconds = 60 * 60 * 1000;

export class TelegramUpdateHandler {
    private readonly log: FastifyBaseLogger;
    private readonly telegramRouter: TelegramRouter;
    private readonly telegramChats: TelegramChats;
    private readonly usersRepository: UsersRepository;
    private readonly usersService: UsersService;
    private readonly lockService: LockService;
    private readonly i18nService: I18nService;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly telegramCommandMenus: TelegramCommandMenus;

    constructor(
        log: FastifyBaseLogger,
        telegramRouter: TelegramRouter,
        telegramChats: TelegramChats,
        usersRepository: UsersRepository,
        usersService: UsersService,
        lockService: LockService,
        i18nService: I18nService,
        telegramMetrics: TelegramMetrics,
        telegramCommandMenus: TelegramCommandMenus,
    ) {
        this.log = log;
        this.telegramRouter = telegramRouter;
        this.telegramChats = telegramChats;
        this.usersRepository = usersRepository;
        this.usersService = usersService;
        this.lockService = lockService;
        this.i18nService = i18nService;
        this.telegramMetrics = telegramMetrics;
        this.telegramCommandMenus = telegramCommandMenus;
    }

    async handle(bot: TelegramBot, update: Update): Promise<void> {
        const startedAt = performance.now();
        const telegramUser = extractTelegramUser(update);
        const chat = extractTelegramChat(update);
        const updateType = extractTelegramUpdateType(update);
        const log = this.log.child({
            botId: bot.id,
            updateId: update.update_id,
            telegramUserId: telegramUser?.id,
        });
        const run: TelegramUpdateRun = {
            bot,
            update,
            log,
            responder: new TelegramResponder(
                chat?.id,
                update.callback_query,
                bot.api,
                log,
            ),
            language: defaultLanguage,
        };

        log.debug({ updateType }, "Received update");

        const finishUpdate = this.telegramMetrics.startUpdate(bot.id, update);
        const result = await this.finish(run, telegramUser);

        finishUpdate(result);
        run.log.info(
            {
                updateType,
                result,
                route: run.route,
                refusedRoute: run.refusedRoute,
                chatId:
                    chat && chat.id !== telegramUser?.id ? chat.id : undefined,
                durationMs: Math.round(performance.now() - startedAt),
            },
            "Update handled",
        );
    }

    private async finish(
        run: TelegramUpdateRun,
        telegramUser: User | undefined,
    ): Promise<TelegramUpdateResult> {
        try {
            await this.process(run, telegramUser);
            return "handled";
        } catch (err) {
            return this.handleFailure(run, err);
        }
    }

    private async process(
        run: TelegramUpdateRun,
        telegramUser: User | undefined,
    ): Promise<void> {
        await this.assertNewUpdate(run);
        assertPrivateChat(run.update);

        if (!telegramUser) {
            throw new TelegramUpdateWithoutUserError();
        }

        const user = await this.resolveUser(run, telegramUser);

        run.language = user.languageCode;

        await this.telegramCommandMenus.sync(user);
        run.route = await this.dispatch(run, user, telegramUser.id);
        await run.responder.answerPendingCallback();
    }

    private async assertNewUpdate({
        bot,
        update,
    }: TelegramUpdateRun): Promise<void> {
        const claim = await this.lockService.tryAcquire(
            `telegram:${bot.id}:update:${update.update_id}`,
            updateClaimTtlMilliseconds,
        );

        if (!claim) {
            throw new DuplicateTelegramUpdateError();
        }
    }

    private async resolveUser(
        run: TelegramUpdateRun,
        telegramUser: User,
    ): Promise<UserEntity> {
        const languageCode = resolveLanguage(telegramUser.language_code);
        const { user, isCreated } =
            await this.usersService.findOrCreateByTelegramId({
                botId: run.bot.id,
                telegramId: String(telegramUser.id),
                ...readProfile(telegramUser, languageCode ?? defaultLanguage),
            });

        run.log = run.log.child({ userId: user._id });

        if (isCreated) {
            this.telegramMetrics.recordUserCreated();
            run.log.info({ isBanned: user.isBanned }, "User created");
        }

        run.log.debug({ isBanned: user.isBanned }, "User for update");

        const profile = readProfile(
            telegramUser,
            languageCode ?? user.languageCode,
        );

        if (isSameProfile(user, profile)) {
            return user;
        }

        return this.usersRepository.updateProfile(user._id, profile);
    }

    private async dispatch(
        run: TelegramUpdateRun,
        user: UserEntity,
        userId: number,
    ): Promise<string> {
        return this.telegramChats.withUpdate(
            {
                update: run.update,
                responder: run.responder,
                userId,
                user,
                log: run.log,
            },
            (ctx) => this.telegramRouter.dispatch(ctx),
        );
    }

    private async handleFailure(
        run: TelegramUpdateRun,
        err: unknown,
    ): Promise<TelegramUpdateResult> {
        if (err instanceof DuplicateTelegramUpdateError) {
            return "duplicate";
        }

        if (err instanceof TelegramUpdateWithoutUserError) {
            return "no_user";
        }

        if (err instanceof NonPrivateChatError) {
            return "ignored";
        }

        if (err instanceof BannedTelegramUserError) {
            await run.responder.answerPendingCallback();
            return "banned";
        }

        if (err instanceof UnhandledTelegramUpdateError) {
            run.refusedRoute = err.refusedRoute;
            await run.responder.answerPendingCallback();
            return "unhandled";
        }

        if (err instanceof TelegramApiError && err.errorCode === 403) {
            return "blocked";
        }

        await this.reportError(run, err);
        return resultOfError(err);
    }

    private async reportError(
        run: TelegramUpdateRun,
        err: unknown,
    ): Promise<void> {
        run.log.error({ err }, "Failed to handle update");
        await run.responder.answerPendingCallback();

        if (!extractTelegramChat(run.update)) {
            return;
        }

        const text = this.translate(run)("telegram:error");

        try {
            await run.responder.reply(text);
        } catch (replyErr) {
            run.log.error({ err: replyErr }, "Failed to send error reply");
        }
    }

    private translate(run: TelegramUpdateRun): Translate {
        return this.i18nService.getT(run.language);
    }
}

function readProfile(telegramUser: User, languageCode: Language): UserProfile {
    return {
        languageCode,
        firstName: telegramUser.first_name,
        username: telegramUser.username,
    };
}

function isSameProfile(user: UserEntity, profile: UserProfile): boolean {
    return (
        user.languageCode === profile.languageCode &&
        user.firstName === profile.firstName &&
        user.username === profile.username
    );
}

function assertPrivateChat(update: Update): void {
    const chat = extractTelegramChat(update);

    if (chat && chat.type !== "private") {
        throw new NonPrivateChatError();
    }
}

function resultOfError(err: unknown): TelegramUpdateResult {
    const errors = err instanceof AggregateError ? err.errors : [err];

    if (errors.some((cause) => cause instanceof LockHoldTimeoutError)) {
        return "lock_hold_timeout";
    }

    if (errors.some((cause) => cause instanceof LockLostError)) {
        return "lock_lost";
    }

    return "error";
}

export default fp(
    async function (fastify: FastifyInstance) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");

        fastify.decorate(
            "telegramUpdateHandler",
            new TelegramUpdateHandler(
                appLogger.child({ module: "telegram" }),
                fastify.getDecorator<TelegramRouter>("telegramRouter"),
                fastify.getDecorator<TelegramChats>("telegramChats"),
                fastify.getDecorator<UsersRepository>("usersRepository"),
                fastify.getDecorator<UsersService>("usersService"),
                fastify.getDecorator<LockService>("lockService"),
                fastify.getDecorator<I18nService>("i18nService"),
                fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
                fastify.getDecorator<TelegramCommandMenus>(
                    "telegramCommandMenus",
                ),
            ),
        );
    },
    {
        name: "telegram-update-handler",
        dependencies: [
            "app-logger",
            "lock-service",
            "i18n-service",
            "telegram-chats",
            "telegram-command-menus",
            "telegram-metrics",
            "telegram-router",
            "users-repository",
            "users-service",
        ],
    },
);
