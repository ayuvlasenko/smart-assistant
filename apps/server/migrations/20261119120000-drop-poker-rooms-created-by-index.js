export async function up(db) {
    await db.collection("pokerRooms").dropIndex("createdBy_lastActivityAt_id");
}

export async function down(db) {
    await db
        .collection("pokerRooms")
        .createIndex(
            { createdBy: 1, lastActivityAt: -1, _id: -1 },
            { name: "createdBy_lastActivityAt_id" },
        );
}
