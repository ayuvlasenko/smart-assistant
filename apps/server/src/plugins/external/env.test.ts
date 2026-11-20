import Fastify from "fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Env } from "../../env.js";
import envPlugin, { autoConfig } from "./env.js";

async function loadEnv(data: Record<string, string | undefined>) {
    const app = Fastify({ logger: false });

    app.register(envPlugin, { ...autoConfig, data });

    try {
        await app.ready();

        return app.getDecorator<Env>("config");
    } finally {
        await app.close();
    }
}

void describe("env", () => {
    void it("takes an IANA time zone", async () => {
        const config = await loadEnv({
            ...process.env,
            TIME_ZONE: "Europe/Kyiv",
        });

        assert.equal(config.TIME_ZONE, "Europe/Kyiv");
    });

    void it("refuses to start with a time zone that Intl does not know", async () => {
        await assert.rejects(
            loadEnv({ ...process.env, TIME_ZONE: "Mars/Base" }),
            /TIME_ZONE must match format "time-zone"/,
        );
    });
});
