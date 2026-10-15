export interface TelegramDeepLink {
    name: string;
    value: string;
}

const deepLinkName = "[a-z0-9]+";
const deepLinkValue = "[A-Za-z0-9_-]+";
const deepLinkNamePattern = new RegExp(`^${deepLinkName}$`);
const deepLinkValuePattern = new RegExp(`^${deepLinkValue}$`);
const deepLinkPayloadPattern = new RegExp(
    `^(${deepLinkName})_(${deepLinkValue})$`,
);
const deepLinkPayloadLimit = 64;

export function assertTelegramDeepLinkName(name: string): void {
    if (!deepLinkNamePattern.test(name)) {
        throw new Error(
            `Telegram deep link name "${name}" must match ${String(deepLinkNamePattern)}`,
        );
    }
}

export function buildTelegramDeepLink({
    name,
    value,
}: TelegramDeepLink): string {
    assertTelegramDeepLinkName(name);

    const payload = `${name}_${value}`;

    if (
        !deepLinkValuePattern.test(value) ||
        payload.length > deepLinkPayloadLimit
    ) {
        throw new Error(
            `Telegram deep link "${name}" needs a value of [A-Za-z0-9_-] that keeps the payload within ${deepLinkPayloadLimit} characters`,
        );
    }

    return payload;
}

export function parseTelegramDeepLink(
    payload: string,
): TelegramDeepLink | undefined {
    const match = deepLinkPayloadPattern.exec(payload);

    if (!match?.[1] || !match[2]) {
        return;
    }

    return { name: match[1], value: match[2] };
}
