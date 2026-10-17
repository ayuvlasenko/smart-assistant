import { MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MetricsService } from "./metrics-service.js";
import { MongoMetrics } from "./mongo-metrics.js";

void describe("MongoMetrics", () => {
    void it("measures the commands of a client by name and result", async (t) => {
        const url = process.env.DATABASE_URL;

        assert.ok(
            url,
            "DATABASE_URL is required for MongoDB integration tests",
        );

        const client = new MongoClient(url, { monitorCommands: true });
        const metrics = new MetricsService();
        const unwatch = new MongoMetrics(metrics).watch(client);

        t.after(async () => {
            unwatch();
            await client.close();
        });
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        await client
            .db("admin")
            .command({ unknownCommandForMetrics: 1 })
            .catch(() => undefined);

        const output = await metrics.metrics();

        assert.match(
            output,
            /^mongodb_command_duration_seconds_count\{command="ping",result="ok"\} 1$/m,
        );
        assert.match(
            output,
            /^mongodb_command_duration_seconds_count\{command="unknownCommandForMetrics",result="error"\} 1$/m,
        );
    });
});
