import { Locales } from "../i18n-service.js";

const en = {
    welcome: "Welcome! You can use the bot now.",
    error: "Something went wrong. Please try again later.",
    cancelCommand: "Cancel the current action",
    sceneCancelled: "Cancelled.",
    nothingToCancel: "There is nothing to cancel.",
    sceneUnexpected: "Please answer the question above, or send /cancel.",
    inputBusy: "Finish the current answer first, or send /cancel.",
    sceneBlocked: "Finish “{{current}}” first, or send /cancel.",
    sceneBlockedStart:
        "To start “{{next}}”, finish “{{current}}” first or send /cancel.",
    buttonExpired: "This button is no longer active.",
    invalidNumber: "Send a number, for example 12.5.",
    numberOutOfRange: "Send a number from {{min}} to {{max}}.",
    invalidDate: "Send a date like 31.12.2026, or use the buttons.",
    today: "Today",
    yesterday: "Yesterday",
    chooseWithButtons: "Choose an option with the buttons above.",
    nothingToChoose: "There is nothing to choose from yet.",
} as const;

export const telegramLocales: Locales<typeof en> = {
    en,
    uk: {
        welcome: "Вітаю! Тепер ви можете користуватися ботом.",
        error: "Щось пішло не так. Спробуйте пізніше.",
        cancelCommand: "Скасувати поточну дію",
        sceneCancelled: "Скасовано.",
        nothingToCancel: "Немає чого скасовувати.",
        sceneUnexpected:
            "Будь ласка, дайте відповідь на питання вище або надішліть /cancel.",
        inputBusy: "Спершу завершіть поточну відповідь або надішліть /cancel.",
        sceneBlocked: "Спершу завершіть «{{current}}» або надішліть /cancel.",
        sceneBlockedStart:
            "Щоб почати «{{next}}», спершу завершіть «{{current}}» або надішліть /cancel.",
        buttonExpired: "Ця кнопка вже неактивна.",
        invalidNumber: "Надішліть число, наприклад 12.5.",
        numberOutOfRange: "Надішліть число від {{min}} до {{max}}.",
        invalidDate:
            "Надішліть дату у форматі 31.12.2026 або скористайтеся кнопками.",
        today: "Сьогодні",
        yesterday: "Вчора",
        chooseWithButtons: "Оберіть варіант кнопками вище.",
        nothingToChoose: "Поки що немає з чого обирати.",
    },
    ru: {
        welcome: "Добро пожаловать! Теперь вы можете пользоваться ботом.",
        error: "Что-то пошло не так. Попробуйте позже.",
        cancelCommand: "Отменить текущее действие",
        sceneCancelled: "Отменено.",
        nothingToCancel: "Нечего отменять.",
        sceneUnexpected:
            "Пожалуйста, ответьте на вопрос выше или отправьте /cancel.",
        inputBusy: "Сначала закончите текущий ответ или отправьте /cancel.",
        sceneBlocked: "Сначала завершите «{{current}}» или отправьте /cancel.",
        sceneBlockedStart:
            "Чтобы начать «{{next}}», сначала завершите «{{current}}» или отправьте /cancel.",
        buttonExpired: "Эта кнопка больше не активна.",
        invalidNumber: "Отправьте число, например 12.5.",
        numberOutOfRange: "Отправьте число от {{min}} до {{max}}.",
        invalidDate:
            "Отправьте дату в формате 31.12.2026 или воспользуйтесь кнопками.",
        today: "Сегодня",
        yesterday: "Вчера",
        chooseWithButtons: "Выберите вариант кнопками выше.",
        nothingToChoose: "Пока не из чего выбирать.",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        telegram: typeof en;
    }
}
