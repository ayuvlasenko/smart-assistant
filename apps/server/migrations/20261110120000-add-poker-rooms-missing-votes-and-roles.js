export async function up(db) {
    const rooms = db.collection("pokerRooms");

    await rooms.updateMany(
        { autoReveal: true },
        { $set: { autoReveal: { missingVotes: 0 } } },
    );
    await rooms.updateMany(
        { autoReveal: false },
        { $set: { autoReveal: null } },
    );
    await rooms.updateMany(
        {},
        { $set: { "participants.$[participant].role": "voter" } },
        { arrayFilters: [{ "participant.role": { $exists: false } }] },
    );
}

export async function down(db) {
    const rooms = db.collection("pokerRooms");

    await rooms.updateMany(
        { autoReveal: null },
        { $set: { autoReveal: false } },
    );
    await rooms.updateMany(
        { autoReveal: { $type: "object" } },
        { $set: { autoReveal: true } },
    );
    await rooms.updateMany({}, { $unset: { "participants.$[].role": "" } });
}
