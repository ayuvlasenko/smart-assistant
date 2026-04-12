import { Update } from "@grammyjs/types";
import { Type } from "@sinclair/typebox";
import { TELEGRAM_SECRET_HEADER } from "../constants/headers.js";

export const telegramWebhookHeadersSchema = Type.Object({
    [TELEGRAM_SECRET_HEADER]: Type.String(),
});

export const telegramUpdateSchema = Type.Unsafe<Update>({ type: "object" });
