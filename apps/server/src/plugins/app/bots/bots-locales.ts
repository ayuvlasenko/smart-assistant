import { Locales } from "../i18n-service.js";

const en = {
    section: "Bots",
    command: "Manage bots",
    listTitle: "Bots",
    rootBot: "Root bot",
    statusLabel: "Status",
    statusActive: "Running",
    statusStopped: "Stopped",
    modulesLabel: "Modules",
    webhookLabel: "Webhook",
    webhookOk: "connected",
    webhookMissing: "not connected",
    webhookPending: "{{count}} updates wait",
    none: "none",
    addButton: "➕ Add bot",
    modulesButton: "🧩 Modules",
    ownerInviteButton: "🔑 Owner link",
    webhookButton: "🔁 Webhook",
    tokenButton: "🔄 Token",
    stopButton: "⏸ Stop",
    confirmStopButton: "⏸ Sure?",
    startButton: "▶️ Start",
    backButton: "‹ Back",
    copyLinkButton: "📋 Copy link",
    modulesTitle: "Modules of {{bot}}",
    ownerInviteTitle: "Owner link of {{bot}}",
    ownerInviteText:
        "Send this link to the owner of the bot. The first user who opens it becomes an admin of the bot. The link works once.",
    tokenPrompt:
        "Send the token of the bot from @BotFather, or /cancel to stop. The message with the token is deleted.",
    tokenFormat: "This is not a bot token. Send it as @BotFather shows it.",
    invalidToken: "Telegram does not accept this token.",
    alreadyAdded: "This bot is already added.",
    keyMissing:
        "The server has no BOTS_ENCRYPTION_KEY, so it can't store a bot token.",
    otherBot: "This token belongs to another bot.",
    tokenReplaced: "The token is replaced.",
    botMissing: "This bot no longer exists.",
    ownerInviteUnavailable:
        "The bot is stopped or its token can't be read, so it has no owner link now. Start the bot or send a new token with 🔄 Token.",
} as const;

export const botsLocales: Locales<typeof en> = {
    en,
    uk: {
        section: "Боти",
        command: "Керувати ботами",
        listTitle: "Боти",
        rootBot: "Кореневий бот",
        statusLabel: "Стан",
        statusActive: "Працює",
        statusStopped: "Зупинено",
        modulesLabel: "Модулі",
        webhookLabel: "Webhook",
        webhookOk: "підключено",
        webhookMissing: "не підключено",
        webhookPending: "чекає оновлень: {{count}}",
        none: "немає",
        addButton: "➕ Додати бота",
        modulesButton: "🧩 Модулі",
        ownerInviteButton: "🔑 Посилання власника",
        webhookButton: "🔁 Webhook",
        tokenButton: "🔄 Токен",
        stopButton: "⏸ Зупинити",
        confirmStopButton: "⏸ Точно?",
        startButton: "▶️ Запустити",
        backButton: "‹ Назад",
        copyLinkButton: "📋 Скопіювати посилання",
        modulesTitle: "Модулі {{bot}}",
        ownerInviteTitle: "Посилання власника {{bot}}",
        ownerInviteText:
            "Надішліть це посилання власнику бота. Перший користувач, який його відкриє, стане адміністратором бота. Посилання працює один раз.",
        tokenPrompt:
            "Надішліть токен бота від @BotFather або /cancel, щоб зупинитися. Повідомлення з токеном буде видалено.",
        tokenFormat:
            "Це не токен бота. Надішліть його так, як показує @BotFather.",
        invalidToken: "Telegram не приймає цей токен.",
        alreadyAdded: "Цього бота вже додано.",
        keyMissing:
            "На сервері немає BOTS_ENCRYPTION_KEY, тому він не може зберегти токен бота.",
        otherBot: "Цей токен належить іншому боту.",
        tokenReplaced: "Токен замінено.",
        botMissing: "Цього бота більше немає.",
        ownerInviteUnavailable:
            "Бот зупинено або його токен не вдається прочитати, тому посилання власника зараз немає. Запустіть бота або надішліть новий токен через 🔄 Токен.",
    },
    ru: {
        section: "Боты",
        command: "Управлять ботами",
        listTitle: "Боты",
        rootBot: "Корневой бот",
        statusLabel: "Состояние",
        statusActive: "Работает",
        statusStopped: "Остановлен",
        modulesLabel: "Модули",
        webhookLabel: "Webhook",
        webhookOk: "подключён",
        webhookMissing: "не подключён",
        webhookPending: "ждут обновлений: {{count}}",
        none: "нет",
        addButton: "➕ Добавить бота",
        modulesButton: "🧩 Модули",
        ownerInviteButton: "🔑 Ссылка владельца",
        webhookButton: "🔁 Webhook",
        tokenButton: "🔄 Токен",
        stopButton: "⏸ Остановить",
        confirmStopButton: "⏸ Точно?",
        startButton: "▶️ Запустить",
        backButton: "‹ Назад",
        copyLinkButton: "📋 Скопировать ссылку",
        modulesTitle: "Модули {{bot}}",
        ownerInviteTitle: "Ссылка владельца {{bot}}",
        ownerInviteText:
            "Отправьте эту ссылку владельцу бота. Первый пользователь, который её откроет, станет администратором бота. Ссылка работает один раз.",
        tokenPrompt:
            "Отправьте токен бота от @BotFather или /cancel, чтобы остановиться. Сообщение с токеном будет удалено.",
        tokenFormat:
            "Это не токен бота. Отправьте его так, как показывает @BotFather.",
        invalidToken: "Telegram не принимает этот токен.",
        alreadyAdded: "Этот бот уже добавлен.",
        keyMissing:
            "На сервере нет BOTS_ENCRYPTION_KEY, поэтому он не может сохранить токен бота.",
        otherBot: "Этот токен принадлежит другому боту.",
        tokenReplaced: "Токен заменён.",
        botMissing: "Этого бота больше нет.",
        ownerInviteUnavailable:
            "Бот остановлен или его токен не удаётся прочитать, поэтому ссылки владельца сейчас нет. Запустите бота или отправьте новый токен через 🔄 Токен.",
    },
};

declare module "i18next" {
    interface ResourceNamespaceMap {
        bots: typeof en;
    }
}
