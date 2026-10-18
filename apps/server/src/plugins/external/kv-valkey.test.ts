import Fastify, { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it, TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { buildTestValkey } from "../../test/valkey.js";
import envPlugin, { autoConfig as envAutoConfig } from "./env.js";
import valkeyPlugin from "./kv-valkey.js";

const EVENT_TIMEOUT_MS = 5000;
const RECONNECT_WINDOW_MS = 1000;

void describe("valkey", () => {
    void it("reconnects after Valkey drops the connection", async (t) => {
        const { client } = await buildValkeyApp(t);
        const { client: admin } = await buildTestValkey(t);
        const connectionId = await client.client("ID");
        const ready = once(client, "ready", {
            signal: AbortSignal.timeout(EVENT_TIMEOUT_MS),
        });

        await admin.client("KILL", "ID", String(connectionId));
        await ready;

        assert.equal(await client.ping(), "PONG");
        assert.notEqual(await client.client("ID"), connectionId);
    });

    void it("closes and stops reconnecting while Valkey is away", async (t) => {
        const { app, client } = await buildValkeyApp(t);
        const { client: admin } = await buildTestValkey(t);
        const reconnecting = once(client, "reconnecting", {
            signal: AbortSignal.timeout(EVENT_TIMEOUT_MS),
        });
        let connectsAfterClose = 0;

        await admin.client("KILL", "ID", String(await client.client("ID")));
        await reconnecting;
        await app.close();
        client.on("connect", () => {
            connectsAfterClose += 1;
        });
        await setTimeout(RECONNECT_WINDOW_MS);

        assert.equal(connectsAfterClose, 0);
    });

    void it("fails the start when Valkey is unreachable", async (t) => {
        await assert.rejects(
            buildValkeyApp(t, { valkeyUrl: "redis://127.0.0.1:1" }),
        );
    });
});

async function buildValkeyApp(
    t: TestContext,
    options: { valkeyUrl?: string } = {},
): Promise<{ app: FastifyInstance; client: Redis }> {
    const app = Fastify({ logger: false });

    app.register(envPlugin, {
        ...envAutoConfig,
        data: {
            ...process.env,
            ...(options.valkeyUrl && { VALKEY_URL: options.valkeyUrl }),
        },
    });
    app.register(valkeyPlugin);

    t.after(() => app.close());

    await app.ready();

    return { app, client: app.getDecorator<Redis>("valkey") };
}
