import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AccessService } from "../access/access-service.js";
import { AppLogger } from "../app-logger.js";
import { I18nService } from "../i18n-service.js";
import { TelegramBotService } from "../telegram/telegram-bot-service.js";
import { TelegramChats } from "../telegram/telegram-chats.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { TelegramCommandMessageUpdate } from "../telegram/telegram-filters.js";
import { TelegramRouter } from "../telegram/telegram-router.js";
import { TelegramSceneEngine } from "../telegram/telegram-scene-engine.js";
import { UsersRepository } from "../users/users-repository.js";
import { createInviteFormScene } from "./invite-form-scene.js";
import { createInviteScene } from "./invite-scene.js";
import { InvitesEvents } from "./invites-events.js";
import {
    buildInvitesListState,
    createInvitesListScene,
    invitesListKey,
} from "./invites-list-scene.js";
import { invitesLocales } from "./invites-locales.js";
import { InvitesService } from "./invites-service.js";

const inviteDeepLinkName = "invite";

export default fp(
    async function (fastify: FastifyInstance) {
        const accessService =
            fastify.getDecorator<AccessService>("accessService");
        const invitesService =
            fastify.getDecorator<InvitesService>("invitesService");
        const usersRepository =
            fastify.getDecorator<UsersRepository>("usersRepository");
        const telegramBotService =
            fastify.getDecorator<TelegramBotService>("telegramBotService");
        const telegramChats =
            fastify.getDecorator<TelegramChats>("telegramChats");
        const router = fastify.getDecorator<TelegramRouter>("telegramRouter");
        const sceneEngine = fastify.getDecorator<TelegramSceneEngine>(
            "telegramSceneEngine",
        );
        const events =
            fastify.getDecorator<Emittery<InvitesEvents>>("eventEmitter");
        const log = fastify
            .getDecorator<AppLogger>("appLogger")
            .child({ module: "invites" });

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("invites", invitesLocales);

        const inviteScene = createInviteScene(
            invitesService,
            accessService,
            (token) =>
                telegramBotService.resolveDeepLinkUrl({
                    name: inviteDeepLinkName,
                    value: token,
                }),
        );
        const inviteFormScene = createInviteFormScene(
            invitesService,
            accessService,
            sceneEngine,
            inviteScene,
        );
        const invitesListScene = createInvitesListScene(
            invitesService,
            accessService,
            sceneEngine,
            inviteScene,
            inviteFormScene,
        );

        router.scene(inviteScene);
        router.scene(inviteFormScene);
        router.scene(invitesListScene);

        router.command(
            "invites",
            async (ctx) => {
                await sceneEngine.start(
                    ctx,
                    invitesListScene,
                    buildInvitesListState(),
                );
            },
            {
                guard: accessService.guard("read", "Invite"),
                description: (t) => t("invites:command"),
            },
        );

        router.deepLink(
            inviteDeepLinkName,
            async (ctx, token) => {
                await acceptInvite(ctx, token);
            },
            { allowBanned: true },
        );

        events.on("invites.inviteActivated", async ({ data }) => {
            try {
                const creator =
                    data.createdBy &&
                    (await usersRepository.findOneById(data.createdBy));

                if (!creator) {
                    return;
                }

                const userId = Number(creator.telegramId);

                telegramChats.deliver(inviteScene, [
                    { userId, key: data.inviteId.toHexString() },
                ]);
                telegramChats.deliver(invitesListScene, [
                    { userId, key: invitesListKey },
                ]);
            } catch (err) {
                log.error({ err }, "Failed to deliver an invite activation");
            }
        });

        async function acceptInvite(
            ctx: TelegramContext<TelegramCommandMessageUpdate>,
            token: string,
        ): Promise<void> {
            const result = await invitesService.activate(ctx.user, token);

            ctx.log.info(
                { inviteResult: result.status },
                "Invite link is used",
            );

            switch (result.status) {
                case "activated":
                case "alreadyActivated":
                    await telegramBotService.syncCommands(result.user);
                    await ctx.reply(
                        ctx.t(
                            ctx.user.isBanned
                                ? "telegram:welcome"
                                : "invites:accessUpdated",
                        ),
                    );
                    return;
                case "notFound":
                    if (!ctx.user.isBanned) {
                        await ctx.reply(ctx.t("invites:inviteNotFound"));
                    }
                    return;
                case "expired":
                case "revoked":
                case "full":
                    await ctx.reply(ctx.t("invites:inviteUnavailable"));
            }
        }
    },
    {
        name: "invites-handlers",
        dependencies: [
            "access-service",
            "app-logger",
            "emittery",
            "i18n-service",
            "invites-service",
            "telegram-bot-service",
            "telegram-chats",
            "telegram-router",
            "telegram-scene-engine",
            "users-repository",
        ],
    },
);
