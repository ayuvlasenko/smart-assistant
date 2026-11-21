import assert from "node:assert/strict";
import { describe, it } from "node:test";

void describe("migrate-mongo-config", () => {
    void it("reads the database name from the path of DATABASE_URL", async () => {
        const config = await loadConfig(
            "mongodb://localhost:27017/smartAssistant?authSource=admin",
        );

        assert.equal(config.mongodb.databaseName, "smartAssistant");
    });

    void it("refuses a DATABASE_URL without a database name once migrate-mongo reads it", async () => {
        const config = await loadConfig("mongodb://localhost:27017");

        assert.throws(
            () => config.mongodb.databaseName,
            /DATABASE_URL must name the database/,
        );
    });
});

async function loadConfig(databaseUrl) {
    const previous = process.env.DATABASE_URL;

    process.env.DATABASE_URL = databaseUrl;

    try {
        const { default: config } = await import(
            `./migrate-mongo-config.js?url=${encodeURIComponent(databaseUrl)}`
        );

        return config;
    } finally {
        process.env.DATABASE_URL = previous;
    }
}
