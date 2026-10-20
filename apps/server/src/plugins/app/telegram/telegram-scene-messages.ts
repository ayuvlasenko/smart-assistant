import { type Static, Type } from "@sinclair/typebox";
import { createHash } from "node:crypto";
import { TelegramContext } from "./telegram-context.js";
import {
    TelegramMessageContent,
    TelegramMessageKind,
} from "./telegram-responder.js";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";

export const telegramSceneMessagesStateSchema = Type.Array(
    Type.Object({
        messageId: Type.Number(),
        kind: Type.Union([
            Type.Literal("text"),
            Type.Literal("rich"),
            Type.Literal("media"),
        ]),
        hash: Type.String(),
    }),
);

type TelegramSceneMessageState = Static<
    typeof telegramSceneMessagesStateSchema
>[number];

export type TelegramSceneMessagesRelease = "keep" | "removeButtons" | "delete";

export class TelegramSceneMessages {
    async render(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        contents: TelegramMessageContent[],
        { reshow = false }: { reshow?: boolean } = {},
    ): Promise<void> {
        const messages = instance.record.messages;
        let mustSend = reshow;

        for (const [index, content] of contents.entries()) {
            const previous = messages[index];
            const hash = hashContent(content);

            if (!mustSend && previous?.hash === hash) {
                continue;
            }

            if (
                !mustSend &&
                previous &&
                canEdit(previous.kind, content.kind) &&
                (await ctx.edit(previous.messageId, content))
            ) {
                messages[index] = { ...previous, kind: content.kind, hash };
                continue;
            }

            const message = await ctx.send(content);

            messages[index] = {
                messageId: message.message_id,
                kind: content.kind,
                hash,
            } satisfies TelegramSceneMessageState;
            mustSend = true;

            if (previous) {
                await this.discard(ctx, previous.messageId);
            }
        }

        while (messages.length > contents.length) {
            const extra = messages.at(-1);

            if (extra) {
                await this.discard(ctx, extra.messageId);
            }

            messages.pop();
        }
    }

    async release(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        release: TelegramSceneMessagesRelease,
    ): Promise<void> {
        for (const message of instance.record.messages) {
            if (release === "removeButtons") {
                await ctx.removeKeyboard(message.messageId);
            } else if (release === "delete") {
                await this.discard(ctx, message.messageId);
            }
        }
    }

    async handOver(
        ctx: TelegramContext,
        source: TelegramSceneInstance,
        target: TelegramSceneInstance,
    ): Promise<void> {
        await this.release(ctx, target, "delete");
        target.record.messages = source.record.messages.map((message) => ({
            ...message,
            hash: "",
        }));
        source.record.messages = [];
    }

    private async discard(
        ctx: TelegramContext,
        messageId: number,
    ): Promise<void> {
        if (!(await ctx.deleteMessage(messageId))) {
            await ctx.removeKeyboard(messageId);
        }
    }
}

function canEdit(
    previous: TelegramMessageKind,
    next: TelegramMessageKind,
): boolean {
    return previous !== "media" || next === "media";
}

function hashContent(content: TelegramMessageContent): string {
    return createHash("sha256")
        .update(JSON.stringify(content))
        .digest("base64url");
}
