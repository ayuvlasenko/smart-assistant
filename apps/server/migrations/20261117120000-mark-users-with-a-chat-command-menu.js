const unknownCommandMenu = "unknown";

export async function up(db) {
    await db
        .collection("users")
        .updateMany(
            { commandMenu: { $exists: false } },
            { $set: { commandMenu: unknownCommandMenu } },
        );
}

export async function down(db) {
    await db
        .collection("users")
        .updateMany({}, { $unset: { commandMenu: "" } });
}
