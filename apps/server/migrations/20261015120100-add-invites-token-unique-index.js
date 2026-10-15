export async function up(db) {
    await db
        .collection("invites")
        .createIndex({ token: 1 }, { unique: true, name: "token_unique" });
}

export async function down(db) {
    await db.collection("invites").dropIndex("token_unique");
}
