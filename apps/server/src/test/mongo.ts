import { config, up } from "migrate-mongo";
import { Db, MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export interface BuildTestMongoOptions {
    databaseName?: string;
    databaseUrl?: string;
}

export interface TestMongo {
    client: MongoClient;
    databaseName: string;
    mongo: Db;
}

const serverRoot = new URL("../../", import.meta.url);
let migrationsConfigured: Promise<void> | undefined;

function createTestDatabaseName(): string {
    return `smart_assistant_test_${randomUUID().replaceAll("-", "")}`;
}

export async function buildTestMongo(
    options: BuildTestMongoOptions = {},
): Promise<TestMongo> {
    const databaseName = options.databaseName ?? createTestDatabaseName();
    const client = new MongoClient(resolveDatabaseUrl(options.databaseUrl));

    await client.connect();

    const mongo = client.db(databaseName);

    await migrate(mongo, client);

    return { client, databaseName, mongo };
}

async function migrate(mongo: Db, client: MongoClient): Promise<void> {
    migrationsConfigured ??= configureMigrations();
    await migrationsConfigured;
    await up(mongo, client);
}

async function configureMigrations(): Promise<void> {
    const file = new URL("migrate-mongo-config.js", serverRoot);
    const { default: projectConfig } = (await import(file.href)) as {
        default: config.Config;
    };

    config.set({
        ...projectConfig,
        migrationsDir: fileURLToPath(new URL("migrations", serverRoot)),
        lockTtl: 0,
    });
}

function resolveDatabaseUrl(databaseUrl?: string): string {
    const resolvedDatabaseUrl = databaseUrl ?? process.env.DATABASE_URL;

    if (!resolvedDatabaseUrl) {
        throw new Error(
            "DATABASE_URL is required for MongoDB integration tests",
        );
    }

    return resolvedDatabaseUrl;
}
