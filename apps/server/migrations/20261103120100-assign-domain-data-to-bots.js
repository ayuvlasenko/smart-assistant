export async function up(db) {
    const botId = readRootBotId();

    await db.collection("pokerRooms").deleteMany({});
    await db
        .collection("invites")
        .updateMany({ botId: { $exists: false } }, { $set: { botId } });
    await moveSettingsToBot(db.collection("settings"), botId);
}

export async function down(db) {
    const settings = db.collection("settings");

    for (const { _id, name, ...document } of await settings
        .find({ name: { $exists: true } }, { projection: { botId: 0 } })
        .toArray()) {
        await settings.updateOne(
            { _id: name },
            { $setOnInsert: document },
            { upsert: true },
        );
        await settings.deleteOne({ _id });
    }

    await settings.dropIndex("botId_name_unique");
    await db.collection("invites").updateMany({}, { $unset: { botId: "" } });
}

async function moveSettingsToBot(settings, botId) {
    for (const { _id: name, ...document } of await settings
        .find({ name: { $exists: false } })
        .toArray()) {
        if (!name.startsWith("poker.")) {
            await settings.updateOne(
                { botId, name },
                { $setOnInsert: document },
                { upsert: true },
            );
        }

        await settings.deleteOne({ _id: name });
    }

    await settings.createIndex(
        { botId: 1, name: 1 },
        { unique: true, name: "botId_name_unique" },
    );
}

function readRootBotId() {
    const [botId] = (process.env.TELEGRAM_BOT_TOKEN ?? "").split(":");

    if (!botId) {
        throw new Error(
            "TELEGRAM_BOT_TOKEN is required to assign the data to the root bot",
        );
    }

    return botId;
}
