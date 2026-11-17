import { Locales } from "../i18n-service.js";

const en = {
    section: "Users",
    autoBanSetting: "Ban new users",
    generalSection: "General",
    languageSetting: "Language",
    languageAuto: "As in Telegram",
} as const;

export const usersLocales: Locales<typeof en> = {
    en,
    uk: {
        section: "Користувачі",
        autoBanSetting: "Блокувати нових користувачів",
        generalSection: "Загальні",
        languageSetting: "Мова",
        languageAuto: "Як у Telegram",
    },
    ru: {
        section: "Пользователи",
        autoBanSetting: "Блокировать новых пользователей",
        generalSection: "Общие",
        languageSetting: "Язык",
        languageAuto: "Как в Telegram",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        users: typeof en;
    }
}
