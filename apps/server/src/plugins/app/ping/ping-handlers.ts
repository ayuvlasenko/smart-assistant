import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AccessService } from "../access/access-service.js";
import { I18nService } from "../i18n-service.js";
import { TelegramRouter } from "../telegram/telegram-router.js";
import { pingLocales } from "./ping-locales.js";

export const pingGrant = "ping.use";

export default fp(
    async function (fastify: FastifyInstance) {
        const accessService =
            fastify.getDecorator<AccessService>("accessService");
        const router = fastify.getDecorator<TelegramRouter>("telegramRouter");

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("ping", pingLocales);

        accessService.register({
            name: "ping",
            title: (t) => t("ping:section"),
            grants: [
                {
                    name: pingGrant,
                    title: (t) => t("ping:useGrant"),
                    define: ({ can }) => {
                        can("use", "Ping");
                    },
                },
            ],
        });

        router.command(
            "ping",
            async (ctx) => {
                await ctx.reply("pong");
            },
            {
                guard: accessService.guard("use", "Ping"),
                description: (t) => t("ping:command"),
            },
        );
    },
    {
        name: "ping-handlers",
        dependencies: ["access-service", "i18n-service", "telegram-router"],
    },
);

declare module "../access/access-service.js" {
    interface AccessSubjects {
        Ping: never;
    }
}
