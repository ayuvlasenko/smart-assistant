import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { text } from "./telegram-filters.js";
import { TelegramRouter } from "./telegram-router.js";
import { TelegramSceneEngine } from "./telegram-scene-engine.js";

export default fp(
    async function (fastify: FastifyInstance) {
        const router = fastify.getDecorator<TelegramRouter>("telegramRouter");
        const sceneEngine = fastify.getDecorator<TelegramSceneEngine>(
            "telegramSceneEngine",
        );

        router.command("start", async (ctx) => {
            await ctx.reply(ctx.t("telegram:welcome"));
        });

        router.command(
            "cancel",
            async (ctx) => {
                if (!(await sceneEngine.cancel(ctx))) {
                    await ctx.reply(ctx.t("telegram:nothingToCancel"));
                }
            },
            { description: (t) => t("telegram:cancelCommand") },
        );

        router.on(text("ping"), async (ctx) => {
            await ctx.reply("pong");
        });
    },
    {
        name: "telegram-system-handlers",
        dependencies: ["telegram-router", "telegram-scene-engine"],
    },
);
