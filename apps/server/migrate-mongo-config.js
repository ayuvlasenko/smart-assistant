const databaseUrl = process.env.DATABASE_URL ?? "";

function readDatabaseName(url) {
    const name = url
        ? decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""))
        : "";

    if (!name) {
        throw new Error(
            "DATABASE_URL must name the database in its path, such as mongodb://host/smartAssistant",
        );
    }

    return name;
}

export default {
    moduleSystem: "esm",
    mongodb: {
        url: databaseUrl,
        get databaseName() {
            return readDatabaseName(databaseUrl);
        },
        options: {},
    },
    migrationsDir: "migrations",
    changelogCollectionName: "migrations",
    migrationFileExtension: ".js",
    useFileHash: false,
    lockCollectionName: "migrations_lock",
    lockTtl: 300,
};
