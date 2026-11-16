import { createHmac, timingSafeEqual } from "node:crypto";

export function telegramWebhookSecret(
    masterSecret: string,
    botId: string,
): string {
    return createHmac("sha256", masterSecret).update(botId).digest("base64url");
}

export function isTelegramWebhookSecret(
    masterSecret: string,
    botId: string,
    secret: string,
): boolean {
    const expected = Buffer.from(telegramWebhookSecret(masterSecret, botId));
    const actual = Buffer.from(secret);

    return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
    );
}
