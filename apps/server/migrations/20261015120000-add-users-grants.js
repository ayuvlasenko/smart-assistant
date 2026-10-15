export async function up(db) {
    await db
        .collection("users")
        .updateMany({ grants: { $exists: false } }, { $set: { grants: [] } });
}

export async function down(db) {
    await db.collection("users").updateMany({}, { $unset: { grants: "" } });
}
