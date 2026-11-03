import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EncryptedBotToken } from "./bot-entity.js";

const algorithm = "aes-256-gcm";
const ivBytes = 12;

export class BotTokenCipher {
    private readonly key: Buffer;

    constructor(key: string) {
        this.key = Buffer.from(key, "base64");
    }

    encrypt(token: string): EncryptedBotToken {
        const iv = randomBytes(ivBytes);
        const cipher = createCipheriv(algorithm, this.key, iv);
        const data = Buffer.concat([
            cipher.update(token, "utf8"),
            cipher.final(),
        ]);

        return {
            iv: iv.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
            data: data.toString("base64"),
        };
    }

    decrypt(token: EncryptedBotToken): string {
        const decipher = createDecipheriv(
            algorithm,
            this.key,
            Buffer.from(token.iv, "base64"),
        );

        decipher.setAuthTag(Buffer.from(token.tag, "base64"));

        return Buffer.concat([
            decipher.update(Buffer.from(token.data, "base64")),
            decipher.final(),
        ]).toString("utf8");
    }
}
