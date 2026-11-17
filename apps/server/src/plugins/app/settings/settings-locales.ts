import { Locales } from "../i18n-service.js";

const en = {
    command: "Settings",
    title: "Settings",
    botTitle: "Bot settings",
    botButton: "⚙️ Bot settings",
    on: "on",
    off: "off",
    none: "none",
    numberPrompt: "Send a whole number, or /cancel to stop.",
    backButton: "‹ Back",
} as const;

export const settingsLocales: Locales<typeof en> = {
    en,
    uk: {
        command: "Налаштування",
        title: "Налаштування",
        botTitle: "Налаштування бота",
        botButton: "⚙️ Налаштування бота",
        on: "увімкнено",
        off: "вимкнено",
        none: "немає",
        numberPrompt: "Надішліть ціле число або /cancel, щоб зупинитися.",
        backButton: "‹ Назад",
    },
    ru: {
        command: "Настройки",
        title: "Настройки",
        botTitle: "Настройки бота",
        botButton: "⚙️ Настройки бота",
        on: "включено",
        off: "выключено",
        none: "нет",
        numberPrompt: "Отправьте целое число или /cancel, чтобы остановиться.",
        backButton: "‹ Назад",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        settings: typeof en;
    }
}
