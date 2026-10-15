import { Locales } from "../i18n-service.js";

const en = {
    section: "Access",
    adminGrant: "Full access",
} as const;

export const accessLocales: Locales<typeof en> = {
    en,
    uk: {
        section: "Доступ",
        adminGrant: "Повний доступ",
    },
    ru: {
        section: "Доступ",
        adminGrant: "Полный доступ",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        access: typeof en;
    }
}
