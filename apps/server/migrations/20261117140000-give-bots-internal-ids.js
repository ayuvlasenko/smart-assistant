import { ObjectId } from "mongodb";

const collectionsWithBotId = ["users", "invites", "settings", "pokerRooms"];
const rootBotId = "root";

export async function up(db) {
    const bots = db.collection("bots");
    const rootTelegramId = readRootTelegramId();
    const hasRootId = (await bots.countDocuments({ _id: rootBotId })) > 0;

    for (const bot of await bots
        .find({ $expr: { $eq: ["$_id", "$telegramId"] } })
        .toArray()) {
        await startMove(
            bots,
            bot,
            bot.telegramId === rootTelegramId && !hasRootId
                ? rootBotId
                : new ObjectId().toHexString(),
        );
    }

    await finishMoves(db);
}

export async function down(db) {
    const bots = db.collection("bots");

    for (const bot of await bots
        .find({
            telegramId: { $exists: true },
            $expr: { $ne: ["$_id", "$telegramId"] },
        })
        .toArray()) {
        await startMove(bots, bot, bot.telegramId);
    }

    await finishMoves(db);
}

async function startMove(bots, { _id, telegramId, ...fields }, newId) {
    if (await bots.findOne({ movedFrom: _id })) {
        return;
    }

    await bots.insertOne({
        ...fields,
        ...(newId === rootBotId ? { isRoot: true } : {}),
        _id: newId,
        movedFrom: _id,
        movedTelegramId: telegramId,
    });
}

async function finishMoves(db) {
    const bots = db.collection("bots");

    for (const { _id, movedFrom } of await bots
        .find({ movedFrom: { $exists: true } })
        .toArray()) {
        for (const name of collectionsWithBotId) {
            await db
                .collection(name)
                .updateMany({ botId: movedFrom }, { $set: { botId: _id } });
        }

        await bots.deleteOne({ _id: movedFrom });
        await bots.updateOne(
            { _id },
            {
                $rename: { movedTelegramId: "telegramId" },
                $unset: { movedFrom: "" },
            },
        );
    }
}

function readRootTelegramId() {
    const [telegramId] = (process.env.TELEGRAM_BOT_TOKEN ?? "").split(":");

    if (!telegramId) {
        throw new Error("TELEGRAM_BOT_TOKEN is required to find the root bot");
    }

    return telegramId;
}
