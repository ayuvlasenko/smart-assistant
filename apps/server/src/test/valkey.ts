import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { TestContext } from "node:test";

export interface BuildTestValkeyOptions {
    keyPrefix?: string;
    valkeyUrl?: string;
}

export function createTestKeyPrefix(): string {
    return `smart-assistant:test:${randomUUID().replaceAll("-", "")}:`;
}

export async function buildTestValkey(
    t: TestContext,
    options: BuildTestValkeyOptions = {},
): Promise<{ client: Redis; keyPrefix: string }> {
    const keyPrefix = options.keyPrefix ?? createTestKeyPrefix();
    const client = new Redis(resolveValkeyUrl(options.valkeyUrl), {
        enableOfflineQueue: false,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
    });

    try {
        await client.connect();
    } catch (err) {
        client.disconnect();
        throw err;
    }

    t.after(async () => {
        try {
            await deleteKeysByPrefix(client, keyPrefix);
        } finally {
            await client.quit();
        }
    });

    return { client, keyPrefix };
}

export async function deleteKeysByPrefix(
    client: Redis,
    keyPrefix: string,
): Promise<void> {
    let cursor = "0";

    do {
        const [nextCursor, keys] = await client.scan(
            cursor,
            "MATCH",
            `${keyPrefix}*`,
            "COUNT",
            100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
            await client.del(...keys);
        }
    } while (cursor !== "0");
}

function resolveValkeyUrl(valkeyUrl?: string): string {
    const resolvedValkeyUrl = valkeyUrl ?? process.env.VALKEY_URL;

    if (!resolvedValkeyUrl) {
        throw new Error("VALKEY_URL is required for Valkey integration tests");
    }

    return resolvedValkeyUrl;
}
