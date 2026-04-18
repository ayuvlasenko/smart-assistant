const databaseUrl = process.env.DATABASE_URL ?? "";

function getDatabaseName(url) {
    if (!url) {
        return "";
    }

    const pathname = new URL(url).pathname.replace(/^\/+/, "");

    return decodeURIComponent(pathname);
}

export default {
    mongodb: {
        url: databaseUrl,
        databaseName: getDatabaseName(databaseUrl),
        options: {},
    },
    migrationsDir: "migrations",
    changelogCollectionName: "migrations",
    migrationFileExtension: ".js",
    useFileHash: false,
    lockCollectionName: "migrations_lock",
    lockTtl: 0,
};
