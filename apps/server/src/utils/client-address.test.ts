import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveClientAddress, resolveClientPort } from "./client-address.js";

void describe("resolveClientAddress", () => {
    void it("prefers Cloudflare client IP over the socket address", () => {
        const address = resolveClientAddress({
            headers: {
                "cf-connecting-ip": "203.0.113.10",
            },
            ip: "198.51.100.20",
        });

        assert.equal(address, "203.0.113.10");
    });

    void it("falls back to the Fastify request IP", () => {
        const address = resolveClientAddress({
            headers: {},
            ip: "198.51.100.20",
        });

        assert.equal(address, "198.51.100.20");
    });
});

void describe("resolveClientPort", () => {
    void it("uses forwarded port before the socket port", () => {
        const port = resolveClientPort({
            headers: {
                "x-forwarded-port": "443",
            },
            socket: {
                remotePort: 54206,
            },
        });

        assert.equal(port, 443);
    });

    void it("falls back to the socket port", () => {
        const port = resolveClientPort({
            headers: {},
            socket: {
                remotePort: 54206,
            },
        });

        assert.equal(port, 54206);
    });
});
