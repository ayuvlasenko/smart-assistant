import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AccessService } from "../access/access-service.js";
import { I18nService } from "../i18n-service.js";
import { TelegramBotService } from "../telegram/telegram-bot-service.js";
import { TelegramChats } from "../telegram/telegram-chats.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { TelegramCommandMessageUpdate } from "../telegram/telegram-filters.js";
import { TelegramRouter } from "../telegram/telegram-router.js";
import { TelegramSceneEngine } from "../telegram/telegram-scene-engine.js";
import { InvitesEvents } from "./invites-events.js";
import { invitesLocales } from "./invites-locales.js";
import {
    buildInvitesState,
    createInvitesScene,
    invitesTopic,
    inviteTopic,
} from "./invites-scene.js";
import { InvitesService } from "./invites-service.js";

const inviteDeepLinkName = "invite";

export default fp(
    async function (fastify: FastifyInstance) {
        const accessService =
            fastify.getDecorator<AccessService>("accessService");
        const invitesService =
            fastify.getDecorator<InvitesService>("invitesService");
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

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("invites", invitesLocales);

        const invitesScene = createInvitesScene(
            invitesService,
            accessService,
            (token) =>
                telegramBotService.resolveDeepLinkUrl({
                    name: inviteDeepLinkName,
                    value: token,
                }),
        );

        router.scene(invitesScene);

        router.command(
            "invites",
            async (ctx) => {
                await sceneEngine.start(ctx, invitesScene, buildInvitesState());
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

        events.on("invites.inviteChanged", ({ data }) => {
            telegramChats.publish([
                invitesTopic,
                inviteTopic(data.inviteId.toHexString()),
            ]);
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
            "emittery",
            "i18n-service",
            "invites-service",
            "telegram-bot-service",
            "telegram-chats",
            "telegram-router",
            "telegram-scene-engine",
        ],
    },
);
