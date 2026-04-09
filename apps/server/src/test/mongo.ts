import { Db, MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";

export interface BuildTestMongoOptions {
    databaseName?: string;
    databaseUrl?: string;
}

export interface TestMongo {
    client: MongoClient;
    databaseName: string;
    mongo: Db;
}

export function createTestDatabaseName(): string {
    return `smart_assistant_test_${randomUUID().replaceAll("-", "")}`;
}

export async function buildTestMongo(
    options: BuildTestMongoOptions = {},
): Promise<TestMongo> {
    const databaseName = options.databaseName ?? createTestDatabaseName();
    const client = new MongoClient(resolveDatabaseUrl(options.databaseUrl));

    await client.connect();

    return {
        client,
        databaseName,
        mongo: client.db(databaseName),
    };
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
