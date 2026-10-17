import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AccessService } from "../access/access-service.js";
import { TelegramChats } from "../telegram/telegram-chats.js";
import { TelegramRouter } from "../telegram/telegram-router.js";
import { TelegramSceneEngine } from "../telegram/telegram-scene-engine.js";
import { SettingsSubjects } from "./setting-entity.js";
import { SettingsEvents } from "./settings-events.js";
import {
    buildSettingsState,
    createSettingsScene,
    settingsTopic,
} from "./settings-scene.js";
import { SettingsService } from "./settings-service.js";

export default fp(
    async function (fastify: FastifyInstance) {
        const access = fastify
            .getDecorator<AccessService>("accessService")
            .subjects<SettingsSubjects>();
        const router = fastify.getDecorator<TelegramRouter>("telegramRouter");
        const sceneEngine = fastify.getDecorator<TelegramSceneEngine>(
            "telegramSceneEngine",
        );
        const telegramChats =
            fastify.getDecorator<TelegramChats>("telegramChats");
        const settingsScene = createSettingsScene(
            fastify.getDecorator<SettingsService>("settingsService"),
            access,
        );

        router.scene(settingsScene);
        router.command(
            "settings",
            async (ctx) => {
                await sceneEngine.start(
                    ctx,
                    settingsScene,
                    buildSettingsState(),
                );
            },
            {
                guard: access.guard("update", "Setting"),
                description: (t) => t("settings:command"),
            },
        );

        fastify
            .getDecorator<Emittery<SettingsEvents>>("eventEmitter")
            .on("settings.settingChanged", () => {
                telegramChats.publish([settingsTopic]);
            });
    },
    {
        name: "settings-handlers",
        dependencies: [
            "access-service",
            "emittery",
            "settings-service",
            "telegram-chats",
            "telegram-router",
            "telegram-scene-engine",
        ],
    },
);
