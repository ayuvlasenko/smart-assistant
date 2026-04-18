export async function up(db) {
    await db.collection("users").createIndex(
        { telegramId: 1 },
        { unique: true, name: "telegramId_unique" },
    );
}

export async function down(db) {
    await db.collection("users").dropIndex("telegramId_unique");
}
