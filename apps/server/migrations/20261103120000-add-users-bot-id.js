export async function up(db) {
    const users = db.collection("users");

    await users.updateMany(
        { botId: { $exists: false } },
        { $set: { botId: readRootBotId() } },
    );
    await users.createIndex(
        { botId: 1, telegramId: 1 },
        { unique: true, name: "botId_telegramId_unique" },
    );
    await users.dropIndex("telegramId_unique");
}

export async function down(db) {
    const users = db.collection("users");

    await users.createIndex(
        { telegramId: 1 },
        { unique: true, name: "telegramId_unique" },
    );
    await users.dropIndex("botId_telegramId_unique");
    await users.updateMany({}, { $unset: { botId: "" } });
}

function readRootBotId() {
    const [botId] = (process.env.TELEGRAM_BOT_TOKEN ?? "").split(":");

    if (!botId) {
        throw new Error(
            "TELEGRAM_BOT_TOKEN is required to assign users to the root bot",
        );
    }

    return botId;
}
