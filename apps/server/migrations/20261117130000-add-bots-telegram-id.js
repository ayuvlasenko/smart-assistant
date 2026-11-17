export async function up(db) {
    await db
        .collection("bots")
        .updateMany({ telegramId: { $exists: false } }, [
            { $set: { telegramId: "$_id" } },
        ]);
    await db.collection("bots").createIndex(
        { telegramId: 1 },
        {
            unique: true,
            name: "telegramId_unique",
            partialFilterExpression: { telegramId: { $exists: true } },
        },
    );
}

export async function down(db) {
    await db.collection("bots").dropIndex("telegramId_unique");
    await db
        .collection("bots")
        .updateMany({}, { $unset: { telegramId: "", isRoot: "" } });
}
