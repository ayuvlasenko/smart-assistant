import { createHmac, timingSafeEqual } from "node:crypto";

export function telegramWebhookSecret(
    masterSecret: string,
    telegramId: string,
): string {
    return createHmac("sha256", masterSecret)
        .update(telegramId)
        .digest("base64url");
}

export function isTelegramWebhookSecret(
    masterSecret: string,
    telegramId: string,
    secret: string,
): boolean {
    const expected = Buffer.from(
        telegramWebhookSecret(masterSecret, telegramId),
    );
    const actual = Buffer.from(secret);

    return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
    );
}
