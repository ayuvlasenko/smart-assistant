import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
    AccessRules,
    AccessService,
    AccessSubjectName,
} from "../access/access-service.js";
import { I18nService } from "../i18n-service.js";
import { TelegramBotService } from "../telegram/telegram-bot-service.js";
import { TelegramChats } from "../telegram/telegram-chats.js";
import { TelegramRouter } from "../telegram/telegram-router.js";
import { TelegramSceneEngine } from "../telegram/telegram-scene-engine.js";
import { UserEntity } from "../users/user-entity.js";
import { PokerEvents } from "./poker-events.js";
import { pokerLocales } from "./poker-locales.js";
import { PokerSubjects } from "./poker-room-entity.js";
import {
    buildPokerRoomState,
    createPokerRoomScene,
    pokerRoomTopic,
} from "./poker-room-scene.js";
import { PokerRoomsService } from "./poker-rooms-service.js";
import {
    buildPokerState,
    createPokerScene,
    pokerRoomsTopic,
} from "./poker-scene.js";

export const pokerJoinGrant = "poker.join";
export const pokerCreateGrant = "poker.create";

const pokerDeepLinkName = "poker";
const pokerRoom: AccessSubjectName<PokerSubjects> = "PokerRoom";

export default fp(
    async function (fastify: FastifyInstance) {
        const access = fastify
            .getDecorator<AccessService>("accessService")
            .subjects<PokerSubjects>();
        const pokerRoomsService =
            fastify.getDecorator<PokerRoomsService>("pokerRoomsService");
        const telegramBotService =
            fastify.getDecorator<TelegramBotService>("telegramBotService");
        const telegramChats =
            fastify.getDecorator<TelegramChats>("telegramChats");
        const router = fastify.getDecorator<TelegramRouter>("telegramRouter");
        const sceneEngine = fastify.getDecorator<TelegramSceneEngine>(
            "telegramSceneEngine",
        );
        const events =
            fastify.getDecorator<Emittery<PokerEvents>>("eventEmitter");

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("poker", pokerLocales);

        access.register({
            name: "poker",
            title: (t) => t("poker:section"),
            grants: [
                {
                    name: pokerJoinGrant,
                    title: (t) => t("poker:joinGrant"),
                    define: defineJoinRules,
                },
                {
                    name: pokerCreateGrant,
                    title: (t) => t("poker:createGrant"),
                    define: (rules, user) => {
                        defineJoinRules(rules, user);
                        rules.can("create", pokerRoom, { createdBy: user._id });
                        rules.can("read", pokerRoom, { createdBy: user._id });
                        rules.can("update", pokerRoom, { createdBy: user._id });
                    },
                },
            ],
        });

        const roomScene = createPokerRoomScene(
            pokerRoomsService,
            access,
            (token) =>
                telegramBotService.resolveDeepLinkUrl({
                    name: pokerDeepLinkName,
                    value: token,
                }),
        );
        const pokerScene = createPokerScene(
            pokerRoomsService,
            access,
            sceneEngine,
            roomScene,
        );

        router.scene(roomScene);
        router.scene(pokerScene);

        router.command(
            "poker",
            async (ctx) => {
                await sceneEngine.start(
                    ctx,
                    pokerScene,
                    buildPokerState(ctx.user._id.toHexString()),
                );
            },
            {
                guard: access.guard("read", pokerRoom),
                description: (t) => t("poker:command"),
            },
        );

        router.deepLink(
            pokerDeepLinkName,
            async (ctx, token) => {
                const result = await pokerRoomsService.join(ctx.user, token);

                ctx.log.info(
                    { pokerJoinResult: result.status },
                    "Poker room link is used",
                );

                if (result.status === "notFound") {
                    await ctx.reply(ctx.t("poker:roomNotFound"));
                    return;
                }

                if (result.status === "closed") {
                    await ctx.reply(ctx.t("poker:roomClosed"));
                    return;
                }

                await sceneEngine.start(
                    ctx,
                    roomScene,
                    buildPokerRoomState(result.room._id.toHexString()),
                );
            },
            { guard: access.guard("use", pokerRoom) },
        );

        events.on("poker.roomChanged", ({ data }) => {
            telegramChats.publish([
                pokerRoomTopic(data.roomId.toHexString()),
                ...data.userIds.map((userId) =>
                    pokerRoomsTopic(userId.toHexString()),
                ),
            ]);
        });
    },
    {
        name: "poker-handlers",
        dependencies: [
            "access-service",
            "emittery",
            "i18n-service",
            "poker-rooms-service",
            "telegram-bot-service",
            "telegram-chats",
            "telegram-router",
            "telegram-scene-engine",
        ],
    },
);

function defineJoinRules(
    { can }: AccessRules<PokerSubjects>,
    user: UserEntity,
): void {
    can("use", pokerRoom);
    can("read", pokerRoom, {
        participants: { $elemMatch: { userId: user._id } },
    });
}
