import { type Static, Type } from "@sinclair/typebox";
import { createHash } from "node:crypto";
import { TelegramContext } from "./telegram-context.js";
import {
    TelegramMessageContent,
    TelegramMessageKind,
} from "./telegram-responder.js";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";
import { TelegramSceneControl } from "./telegram-scene.js";

export const telegramSlotsStateSchema = Type.Record(
    Type.String(),
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

type TelegramSlotState = Static<typeof telegramSlotsStateSchema>[string];

export type TelegramSlotMessages = "keep" | "removeButtons" | "delete";

export type TelegramSlotSceneFactory = (
    slotMessageId: number | undefined,
) => TelegramSceneControl<Record<string, unknown>>;

export class TelegramSceneSlots {
    async render(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        sceneFor: TelegramSlotSceneFactory,
        { reshow = false }: { reshow?: boolean } = {},
    ): Promise<void> {
        for (const [name, render] of Object.entries(instance.scene.slots)) {
            const slot = instance.record.slots[name];
            const content = await render(ctx, sceneFor(slot?.messageId));

            await this.show(ctx, instance, name, content, reshow);
        }
    }

    async release(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        messages: TelegramSlotMessages,
    ): Promise<void> {
        for (const slot of Object.values(instance.record.slots)) {
            if (messages === "removeButtons") {
                await ctx.removeKeyboard(slot.messageId);
            } else if (messages === "delete") {
                await this.discard(ctx, slot.messageId);
            }
        }
    }

    private async show(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        name: string,
        content: TelegramMessageContent | undefined,
        reshow: boolean,
    ): Promise<void> {
        const slots = instance.record.slots;
        const previous = slots[name];

        if (!content) {
            if (previous) {
                await this.discard(ctx, previous.messageId);
                delete slots[name];
            }

            return;
        }

        const hash = hashContent(content);

        if (!reshow && previous?.hash === hash) {
            return;
        }

        if (
            !reshow &&
            previous &&
            canEdit(previous.kind, content.kind) &&
            (await ctx.edit(previous.messageId, content))
        ) {
            slots[name] = { ...previous, kind: content.kind, hash };
            return;
        }

        const message = await ctx.send(content);

        slots[name] = {
            messageId: message.message_id,
            kind: content.kind,
            hash,
        } satisfies TelegramSlotState;

        if (previous) {
            await this.discard(ctx, previous.messageId);
        }
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
