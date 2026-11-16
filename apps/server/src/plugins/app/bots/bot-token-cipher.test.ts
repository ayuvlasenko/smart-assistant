import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { BotTokenCipher } from "./bot-token-cipher.js";

void describe("BotTokenCipher", () => {
    void it("decrypts the token it encrypted and never stores it in the clear", () => {
        const cipher = new BotTokenCipher(randomBytes(32).toString("base64"));
        const encrypted = cipher.encrypt("42:secret-token");

        assert.ok(!JSON.stringify(encrypted).includes("secret-token"));
        assert.notDeepEqual(cipher.encrypt("42:secret-token"), encrypted);
        assert.equal(cipher.decrypt(encrypted), "42:secret-token");
    });

    void it("refuses a token of another key", () => {
        const encrypted = new BotTokenCipher(
            randomBytes(32).toString("base64"),
        ).encrypt("42:secret-token");

        assert.throws(() =>
            new BotTokenCipher(randomBytes(32).toString("base64")).decrypt(
                encrypted,
            ),
        );
    });
});
