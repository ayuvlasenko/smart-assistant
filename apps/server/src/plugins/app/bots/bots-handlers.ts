import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AccessService } from "../access/access-service.js";
import { I18nService } from "../i18n-service.js";
import { TelegramChats } from "../telegram/telegram-chats.js";
import { TelegramRouter } from "../telegram/telegram-router.js";
import { TelegramSceneEngine } from "../telegram/telegram-scene-engine.js";
import { BotsSubjects } from "./bot-entity.js";
import { BotsEvents } from "./bots-events.js";
import { botsLocales } from "./bots-locales.js";
import { botsModule, BotsRegistry } from "./bots-registry.js";
import { botsTopic, buildBotsState, createBotsScene } from "./bots-scene.js";
import { BotsService } from "./bots-service.js";

export default fp(
    async function (fastify: FastifyInstance) {
        const access = fastify
            .getDecorator<AccessService>("accessService")
            .subjects<BotsSubjects>();
        const telegramChats =
            fastify.getDecorator<TelegramChats>("telegramChats");
        const router = fastify.getDecorator<TelegramRouter>("telegramRouter");
        const sceneEngine = fastify.getDecorator<TelegramSceneEngine>(
            "telegramSceneEngine",
        );
        const botsRegistry = fastify.getDecorator<BotsRegistry>("botsRegistry");

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("bots", botsLocales);

        access.register(
            {
                name: botsModule,
                title: (t) => t("bots:section"),
                grants: [],
            },
            { subjects: ["Bot"] },
        );

        const botsScene = createBotsScene(
            fastify.getDecorator<BotsService>("botsService"),
            access,
        );

        router.scene(botsScene);
        router.command(
            "bots",
            async (ctx) => {
                await sceneEngine.start(ctx, botsScene, buildBotsState());
            },
            {
                guard: access.guard("read", "Bot"),
                description: (t) => t("bots:command"),
            },
        );

        fastify
            .getDecorator<Emittery<BotsEvents>>("eventEmitter")
            .on("bots.botChanged", () => {
                telegramChats.publish(botsRegistry.rootId, [botsTopic]);
            });
    },
    {
        name: "bots-handlers",
        dependencies: [
            "access-service",
            "bots-registry",
            "bots-service",
            "emittery",
            "i18n-service",
            "invites-handlers",
            "telegram-chats",
            "telegram-router",
            "telegram-scene-engine",
        ],
    },
);
