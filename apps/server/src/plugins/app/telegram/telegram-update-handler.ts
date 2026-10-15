import { Update, User } from "@grammyjs/types";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../schemas/env.js";
import { AppLogger } from "../app-logger.js";
import {
    defaultLanguage,
    I18nService,
    Language,
    resolveLanguage,
    Translate,
} from "../i18n-service.js";
import { LockService } from "../lock-service.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { TelegramApiClient } from "./telegram-api-service.js";
import { TelegramChats } from "./telegram-chats.js";
import {
    BannedTelegramUserError,
    DuplicateTelegramUpdateError,
    NonPrivateChatError,
    TelegramUpdateWithoutUserError,
    UnhandledTelegramUpdateError,
} from "./telegram-errors.js";
import {
    extractTelegramChat,
    extractTelegramCommand,
    extractTelegramUpdateType,
    extractTelegramUser,
} from "./telegram-extractors.js";
import { TelegramMetrics, TelegramUpdateResult } from "./telegram-metrics.js";
import { TelegramResponder } from "./telegram-responder.js";
import { TelegramRouter } from "./telegram-router.js";

type TelegramUpdateHandlerConfig = Pick<Env, "INVITE_TOKEN">;

interface TelegramUpdateRun {
    update: Update;
    log: FastifyBaseLogger;
    responder: TelegramResponder;
    language: Language;
}

const updateClaimTtlMilliseconds = 24 * 60 * 60 * 1000;

export class TelegramUpdateHandler {
    private readonly log: FastifyBaseLogger;
    private readonly telegramApiService: TelegramApiClient;
    private readonly telegramRouter: TelegramRouter;
    private readonly telegramChats: TelegramChats;
    private readonly usersRepository: UsersRepository;
    private readonly lockService: LockService;
    private readonly i18nService: I18nService;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly config: TelegramUpdateHandlerConfig;

    constructor(
        log: FastifyBaseLogger,
        telegramApiService: TelegramApiClient,
        telegramRouter: TelegramRouter,
        telegramChats: TelegramChats,
        usersRepository: UsersRepository,
        lockService: LockService,
        i18nService: I18nService,
        telegramMetrics: TelegramMetrics,
        config: TelegramUpdateHandlerConfig,
    ) {
        this.log = log;
        this.telegramApiService = telegramApiService;
        this.telegramRouter = telegramRouter;
        this.telegramChats = telegramChats;
        this.usersRepository = usersRepository;
        this.lockService = lockService;
        this.i18nService = i18nService;
        this.telegramMetrics = telegramMetrics;
        this.config = config;
    }

    async handle(update: Update): Promise<void> {
        const telegramUser = extractTelegramUser(update);
        const log = this.log.child({
            updateId: update.update_id,
            chatId: extractTelegramChat(update)?.id ?? telegramUser?.id,
            telegramUserId: telegramUser?.id,
        });
        const run: TelegramUpdateRun = {
            update,
            log,
            responder: new TelegramResponder(
                extractTelegramChat(update)?.id,
                update.callback_query,
                this.telegramApiService,
                log,
            ),
            language: defaultLanguage,
        };

        log.info(
            { updateType: extractTelegramUpdateType(update) },
            "Received update",
        );

        const finishUpdate = this.telegramMetrics.startUpdate(update);

        try {
            await this.process(run, telegramUser);
            finishUpdate("handled");
        } catch (err) {
            finishUpdate(await this.handleFailure(run, err));
        }
    }

    private async process(
        run: TelegramUpdateRun,
        telegramUser: User | undefined,
    ): Promise<void> {
        await this.assertNewUpdate(run.update);
        assertPrivateChat(run.update);

        if (!telegramUser) {
            throw new TelegramUpdateWithoutUserError();
        }

        const user = await this.resolveUser(telegramUser);

        run.language = user.languageCode;

        if (user.isBanned) {
            await this.acceptInvite(run, user);
        } else {
            await this.dispatch(run, user, telegramUser.id);
        }

        await run.responder.answerPendingCallback();
    }

    private async assertNewUpdate(update: Update): Promise<void> {
        const claim = await this.lockService.tryAcquire(
            `telegram:update:${update.update_id}`,
            updateClaimTtlMilliseconds,
        );

        if (!claim) {
            throw new DuplicateTelegramUpdateError();
        }
    }

    private async resolveUser(telegramUser: User): Promise<UserEntity> {
        const languageCode = resolveLanguage(telegramUser.language_code);
        const user = await this.usersRepository.findOneByTelegramIdOrCreate({
            telegramId: String(telegramUser.id),
            isBanned: true,
            languageCode: languageCode ?? defaultLanguage,
        });

        this.log.info({ user }, "User for update");

        if (!languageCode || user.languageCode === languageCode) {
            return user;
        }

        return this.usersRepository.updateLanguage(user._id, languageCode);
    }

    private async acceptInvite(
        run: TelegramUpdateRun,
        user: UserEntity,
    ): Promise<void> {
        const command = extractTelegramCommand(run.update);
        const isInvite =
            !!this.config.INVITE_TOKEN &&
            command?.name === "start" &&
            command.payload === this.config.INVITE_TOKEN;

        if (!isInvite) {
            throw new BannedTelegramUserError();
        }

        await this.usersRepository.unban(user._id);
        run.log.info("User is unbanned by invite");

        await run.responder.reply(this.translate(run)("telegram:welcome"));
    }

    private async dispatch(
        run: TelegramUpdateRun,
        user: UserEntity,
        userId: number,
    ): Promise<void> {
        await this.telegramChats.withUpdate(
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
            run.log.info("Update was already received, skipping");
            return "duplicate";
        }

        if (err instanceof TelegramUpdateWithoutUserError) {
            run.log.warn("No user in update, skipping");
            return "no_user";
        }

        if (err instanceof NonPrivateChatError) {
            run.log.info("Update is not from a private chat, skipping");
            return "ignored";
        }

        if (err instanceof BannedTelegramUserError) {
            run.log.info("User is banned, skipping update");
            await run.responder.answerPendingCallback();
            return "banned";
        }

        if (err instanceof UnhandledTelegramUpdateError) {
            return this.replyUnknown(run);
        }

        await this.reportError(run, err);
        return "error";
    }

    private async replyUnknown(
        run: TelegramUpdateRun,
    ): Promise<TelegramUpdateResult> {
        await run.responder.answerPendingCallback();

        if (!run.update.message) {
            return "unhandled";
        }

        try {
            await run.responder.reply(this.translate(run)("telegram:unknown"));
            return "unhandled";
        } catch (err) {
            await this.reportError(run, err);
            return "error";
        }
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

function assertPrivateChat(update: Update): void {
    const chat = extractTelegramChat(update);

    if (chat && chat.type !== "private") {
        throw new NonPrivateChatError();
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");

        fastify.decorate(
            "telegramUpdateHandler",
            new TelegramUpdateHandler(
                appLogger.child({ module: "telegram" }),
                fastify.getDecorator<TelegramApiClient>("telegramApiService"),
                fastify.getDecorator<TelegramRouter>("telegramRouter"),
                fastify.getDecorator<TelegramChats>("telegramChats"),
                fastify.getDecorator<UsersRepository>("usersRepository"),
                fastify.getDecorator<LockService>("lockService"),
                fastify.getDecorator<I18nService>("i18nService"),
                fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
                fastify.config,
            ),
        );
    },
    {
        name: "telegram-update-handler",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "lock-service",
            "i18n-service",
            "telegram-api-service",
            "telegram-chats",
            "telegram-metrics",
            "telegram-router",
            "users-repository",
        ],
    },
);
