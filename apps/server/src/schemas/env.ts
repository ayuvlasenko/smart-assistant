import { Static, Type } from "@sinclair/typebox";

export const envSchema = Type.Object({
    DATABASE_URL: Type.String(),
    RATE_LIMIT_MAX: Type.Number({ default: 100 }),
    STATIC_DIRNAME: Type.String({ default: "static" }),
    ENABLE_SECURITY_HEADERS: Type.Boolean({ default: true }),
    JWT_ACCESS_SECRET: Type.String(),
    JWT_ACCESS_EXPIRES_IN: Type.String({ default: "1h" }),
    JWT_REFRESH_SECRET: Type.String(),
    JWT_REFRESH_EXPIRES_IN: Type.String({ default: "7d" }),
    PORT: Type.Number({ default: 3020 }),
    DOMAIN: Type.String(),
    S3_ACCESS_KEY_ID: Type.String(),
    S3_SECRET_ACCESS_KEY: Type.String(),
    S3_REGION: Type.String(),
    S3_BUCKET: Type.String(),
    S3_ENDPOINT: Type.String(),
    TELEGRAM_BOT_TOKEN: Type.String(),
    TELEGRAM_WEBHOOK_SECRET_TOKEN: Type.String(),
    TELEGRAM_WEBHOOK_URL: Type.String(),
});

export type Env = Static<typeof envSchema>;
