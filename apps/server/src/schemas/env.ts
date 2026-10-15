import { Static, Type } from "@sinclair/typebox";

export const envSchema = Type.Object({
    DATABASE_URL: Type.String(),
    ENVIRONMENT: Type.Union([
        Type.Literal("production"),
        Type.Literal("preview"),
    ]),
    RATE_LIMIT_MAX: Type.Number({ default: 100 }),
    STATIC_DIRNAME: Type.String({ default: "static" }),
    ENABLE_SECURITY_HEADERS: Type.Boolean({ default: true }),
    PORT: Type.Number({ default: 3020 }),
    RESOURCE_NAME: Type.String(),
    DOMAIN: Type.String(),
    S3_ACCESS_KEY_ID: Type.String(),
    S3_SECRET_ACCESS_KEY: Type.String(),
    S3_REGION: Type.String(),
    S3_BUCKET: Type.String(),
    S3_ENDPOINT: Type.String(),
    TELEGRAM_BOT_TOKEN: Type.String(),
    INVITE_TOKEN: Type.Optional(
        Type.String({ pattern: "^[A-Za-z0-9_-]{1,57}$" }),
    ),
    TIME_ZONE: Type.String({ default: "UTC" }),
    TELEGRAM_WEBHOOK_SECRET_TOKEN: Type.String(),
    TELEGRAM_WEBHOOK_URL: Type.Optional(Type.String()),
    VALKEY_URL: Type.String(),
    VALKEY_CONNECT_TIMEOUT_MS: Type.Number({ default: 500 }),
});

export type Env = Static<typeof envSchema>;
