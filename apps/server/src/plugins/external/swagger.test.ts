import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTestApp } from "../../test/helper.js";

interface OpenApiDocument {
    paths: Record<string, unknown>;
}

void describe("swagger", () => {
    void it("documents the webhook refresh route on preview", async (t) => {
        const { app } = await buildTestApp({ t, environment: "preview" });

        const response = await app.inject({
            method: "GET",
            url: "/api/docs/json",
        });

        assert.equal(response.statusCode, 200);
        assert.ok(
            "/api/telegram/webhook/refresh" in
                response.json<OpenApiDocument>().paths,
        );
    });

    void it("is not exposed on production", async (t) => {
        const { app } = await buildTestApp({ t, environment: "production" });

        const response = await app.inject({
            method: "GET",
            url: "/api/docs/json",
        });

        assert.equal(response.statusCode, 404);
    });
});
