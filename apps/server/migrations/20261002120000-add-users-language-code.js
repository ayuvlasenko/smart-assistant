export async function up(db) {
    await db
        .collection("users")
        .updateMany(
            { languageCode: { $exists: false } },
            { $set: { languageCode: "en" } },
        );
}

export async function down(db) {
    await db
        .collection("users")
        .updateMany({}, { $unset: { languageCode: "" } });
}
