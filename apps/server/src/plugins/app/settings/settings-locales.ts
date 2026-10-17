import { Locales } from "../i18n-service.js";

const en = {
    command: "Bot settings",
    title: "Settings",
    on: "on",
    off: "off",
    none: "none",
    numberPrompt: "Send a whole number, or /cancel to stop.",
    hideButton: "✖️ Hide",
    backButton: "‹ Back",
} as const;

export const settingsLocales: Locales<typeof en> = {
    en,
    uk: {
        command: "Налаштування бота",
        title: "Налаштування",
        on: "увімкнено",
        off: "вимкнено",
        none: "немає",
        numberPrompt: "Надішліть ціле число або /cancel, щоб зупинитися.",
        hideButton: "✖️ Сховати",
        backButton: "‹ Назад",
    },
    ru: {
        command: "Настройки бота",
        title: "Настройки",
        on: "включено",
        off: "выключено",
        none: "нет",
        numberPrompt: "Отправьте целое число или /cancel, чтобы остановиться.",
        hideButton: "✖️ Скрыть",
        backButton: "‹ Назад",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        settings: typeof en;
    }
}
