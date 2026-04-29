import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { envSchema } from "./env.js";

const valkeyUrlSchema = envSchema.properties.VALKEY_URL;

void describe("envSchema", () => {
    void it("rejects unresolved Kubernetes placeholders in VALKEY_URL", () => {
        assert.equal(
            Value.Check(
                valkeyUrlSchema,
                "redis://default:$(VALKEY_PASSWORD)@valkey-main:6379",
            ),
            false,
        );
    });

    void it("accepts a resolved Redis VALKEY_URL", () => {
        assert.equal(
            Value.Check(
                valkeyUrlSchema,
                "redis://default:resolved-password@valkey-main:6379",
            ),
            true,
        );
    });
});
