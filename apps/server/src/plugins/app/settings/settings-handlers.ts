import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AccessService } from "../access/access-service.js";
import { TelegramChats } from "../telegram/telegram-chats.js";
import { TelegramCommandMenus } from "../telegram/telegram-command-menus.js";
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
import { UserSettingsService } from "./user-settings-service.js";

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
        const telegramCommandMenus = fastify.getDecorator<TelegramCommandMenus>(
            "telegramCommandMenus",
        );
        const settingsScene = createSettingsScene(
            fastify.getDecorator<SettingsService>("settingsService"),
            fastify.getDecorator<UserSettingsService>("userSettingsService"),
            access,
        );
        const events =
            fastify.getDecorator<Emittery<SettingsEvents>>("eventEmitter");

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
            { description: (t) => t("settings:command") },
        );

        events.on("settings.userSettingChanged", ({ data }) =>
            telegramCommandMenus.syncUser(data.user),
        );
        events.on("settings.settingChanged", async ({ data }) => {
            telegramChats.publish(data.botId, [settingsTopic]);

            await telegramCommandMenus.syncBotById(data.botId);
        });
    },
    {
        name: "settings-handlers",
        dependencies: [
            "access-service",
            "emittery",
            "settings-service",
            "telegram-chats",
            "telegram-command-menus",
            "telegram-router",
            "telegram-scene-engine",
            "user-settings-service",
        ],
    },
);
