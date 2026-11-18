import { config, up } from "migrate-mongo";
import { Db, MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach } from "node:test";
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
let migrationsConfigured: Promise<config.Config> | undefined;

function createTestDatabaseName(): string {
    return `smart_assistant_test_${randomUUID().replaceAll("-", "")}`;
}

export function useTestMongo(): TestMongo {
    let current: TestMongo | undefined;
    const read = (): TestMongo => {
        if (!current) {
            throw new Error("The test database is read before its before hook");
        }

        return current;
    };

    before(async () => {
        current = await buildTestMongo();
    });
    beforeEach(async () => {
        await clearCollections(read().mongo);
    });
    after(async () => {
        await read().mongo.dropDatabase();
        await read().client.close();
    });

    return {
        get client() {
            return read().client;
        },
        get databaseName() {
            return read().databaseName;
        },
        get mongo() {
            return read().mongo;
        },
    };
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

async function clearCollections(mongo: Db): Promise<void> {
    const { changelogCollectionName, lockCollectionName } =
        await readMigrationsConfig();
    const collections = await mongo
        .listCollections({}, { nameOnly: true })
        .toArray();

    await Promise.all(
        collections
            .map(({ name }) => name)
            .filter(
                (name) =>
                    name !== changelogCollectionName &&
                    name !== lockCollectionName &&
                    !name.startsWith("system."),
            )
            .map((name) => mongo.collection(name).deleteMany({})),
    );
}

async function migrate(mongo: Db, client: MongoClient): Promise<void> {
    await readMigrationsConfig();
    await up(mongo, client);
}

function readMigrationsConfig(): Promise<config.Config> {
    migrationsConfigured ??= configureMigrations();

    return migrationsConfigured;
}

async function configureMigrations(): Promise<config.Config> {
    const file = new URL("migrate-mongo-config.js", serverRoot);
    const { default: projectConfig } = (await import(file.href)) as {
        default: config.Config;
    };

    const testConfig = {
        ...projectConfig,
        migrationsDir: fileURLToPath(new URL("migrations", serverRoot)),
        lockTtl: 0,
    };

    config.set(testConfig);

    return testConfig;
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
