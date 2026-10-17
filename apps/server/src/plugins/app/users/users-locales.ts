import { Locales } from "../i18n-service.js";

const en = {
    section: "Users",
    autoBanSetting: "Ban new users",
} as const;

export const usersLocales: Locales<typeof en> = {
    en,
    uk: {
        section: "Користувачі",
        autoBanSetting: "Блокувати нових користувачів",
    },
    ru: {
        section: "Пользователи",
        autoBanSetting: "Блокировать новых пользователей",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        users: typeof en;
    }
}
