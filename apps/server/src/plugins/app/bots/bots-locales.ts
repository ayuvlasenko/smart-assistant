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
    moveButton: "🔀 Move",
    confirmMoveButton: "🔀 Sure?",
    startButton: "▶️ Start",
    backButton: "‹ Back",
    copyLinkButton: "📋 Copy link",
    modulesTitle: "Modules of {{bot}}",
    startLabel: "On /start",
    startWelcome: "welcome message",
    startModuleButton: "🏁 On /start",
    startModuleTitle: "What /start opens in {{bot}}",
    startModuleText:
        "Pick a module of the bot that has a start screen. A user who can't open it gets the welcome message.",
    startWelcomeButton: "Welcome message",
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
    otherBot:
        "This token belongs to another bot. To move this bot there, use 🔀 Move.",
    tokenReplaced: "The token is replaced.",
    movePrompt:
        "Send the token of the new bot from @BotFather, or /cancel to stop. The users keep their access and their data, and each of them has to open the new bot. The message with the token is deleted.",
    sameBot:
        "This is a token of the same bot. To replace its token, use 🔄 Token.",
    botMoved: "The bot is moved. Its users have to open the new bot.",
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
        moveButton: "🔀 Перенести",
        confirmMoveButton: "🔀 Точно?",
        startButton: "▶️ Запустити",
        backButton: "‹ Назад",
        copyLinkButton: "📋 Скопіювати посилання",
        modulesTitle: "Модулі {{bot}}",
        startLabel: "На /start",
        startWelcome: "вітальне повідомлення",
        startModuleButton: "🏁 На /start",
        startModuleTitle: "Що відкриває /start у {{bot}}",
        startModuleText:
            "Виберіть модуль бота, який має стартовий екран. Користувач, який не може його відкрити, отримає вітальне повідомлення.",
        startWelcomeButton: "Вітальне повідомлення",
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
        otherBot:
            "Цей токен належить іншому боту. Щоб перенести цього бота туди, скористайтеся 🔀 Перенести.",
        tokenReplaced: "Токен замінено.",
        movePrompt:
            "Надішліть токен нового бота від @BotFather або /cancel, щоб зупинитися. Користувачі збережуть доступ і дані, і кожен із них має відкрити нового бота. Повідомлення з токеном буде видалено.",
        sameBot:
            "Це токен того самого бота. Щоб замінити його токен, скористайтеся 🔄 Токен.",
        botMoved:
            "Бота перенесено. Його користувачі мають відкрити нового бота.",
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
        moveButton: "🔀 Перенести",
        confirmMoveButton: "🔀 Точно?",
        startButton: "▶️ Запустить",
        backButton: "‹ Назад",
        copyLinkButton: "📋 Скопировать ссылку",
        modulesTitle: "Модули {{bot}}",
        startLabel: "На /start",
        startWelcome: "приветствие",
        startModuleButton: "🏁 На /start",
        startModuleTitle: "Что открывает /start в {{bot}}",
        startModuleText:
            "Выберите модуль бота, у которого есть стартовый экран. Пользователь, который не может его открыть, получит приветствие.",
        startWelcomeButton: "Приветствие",
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
        otherBot:
            "Этот токен принадлежит другому боту. Чтобы перенести этого бота туда, воспользуйтесь 🔀 Перенести.",
        tokenReplaced: "Токен заменён.",
        movePrompt:
            "Отправьте токен нового бота от @BotFather или /cancel, чтобы остановиться. Пользователи сохранят доступ и данные, и каждому из них нужно открыть нового бота. Сообщение с токеном будет удалено.",
        sameBot:
            "Это токен того же бота. Чтобы заменить его токен, воспользуйтесь 🔄 Токен.",
        botMoved: "Бот перенесён. Его пользователям нужно открыть нового бота.",
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
