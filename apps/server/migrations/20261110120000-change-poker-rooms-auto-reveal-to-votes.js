export async function up(db) {
    const rooms = db.collection("pokerRooms");

    await rooms.updateMany(
        { autoReveal: true },
        { $set: { autoReveal: "all" } },
    );
    await rooms.updateMany(
        { autoReveal: false },
        { $set: { autoReveal: "off" } },
    );
}

export async function down(db) {
    const rooms = db.collection("pokerRooms");

    await rooms.updateMany(
        { autoReveal: "off" },
        { $set: { autoReveal: false } },
    );
    await rooms.updateMany(
        { autoReveal: { $ne: false } },
        { $set: { autoReveal: true } },
    );
}
