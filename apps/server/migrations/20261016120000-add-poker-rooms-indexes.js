export async function up(db) {
    const rooms = db.collection("pokerRooms");

    await rooms.createIndex(
        { token: 1 },
        { unique: true, name: "token_unique" },
    );
    await rooms.createIndex(
        { "participants.userId": 1, lastActivityAt: -1, _id: -1 },
        { name: "participants_userId_lastActivityAt_id" },
    );
    await rooms.createIndex(
        { createdBy: 1, lastActivityAt: -1, _id: -1 },
        { name: "createdBy_lastActivityAt_id" },
    );
}

export async function down(db) {
    const rooms = db.collection("pokerRooms");

    await rooms.dropIndex("createdBy_lastActivityAt_id");
    await rooms.dropIndex("participants_userId_lastActivityAt_id");
    await rooms.dropIndex("token_unique");
}
