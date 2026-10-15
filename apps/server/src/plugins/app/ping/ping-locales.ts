import { Locales } from "../i18n-service.js";

const en = {
    section: "Ping",
    useGrant: "Use /ping",
    command: "Check that the bot answers",
} as const;

export const pingLocales: Locales<typeof en> = {
    en,
    uk: {
        section: "Ping",
        useGrant: "Користуватися /ping",
        command: "Перевірити, що бот відповідає",
    },
    ru: {
        section: "Ping",
        useGrant: "Пользоваться /ping",
        command: "Проверить, что бот отвечает",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        ping: typeof en;
    }
}
