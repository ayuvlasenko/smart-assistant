import { Locales } from "../i18n-service.js";

const en = {
    section: "Access",
    adminGrant: "Full access",
    defaultGrantsSetting: "Default access",
} as const;

export const accessLocales: Locales<typeof en> = {
    en,
    uk: {
        section: "Доступ",
        adminGrant: "Повний доступ",
        defaultGrantsSetting: "Доступ за замовчуванням",
    },
    ru: {
        section: "Доступ",
        adminGrant: "Полный доступ",
        defaultGrantsSetting: "Доступ по умолчанию",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        access: typeof en;
    }
}
