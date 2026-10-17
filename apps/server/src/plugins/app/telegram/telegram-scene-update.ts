import { Update } from "@grammyjs/types";
import { TelegramContext, TelegramMessageChange } from "./telegram-context.js";
import { extractTelegramCommand } from "./telegram-extractors.js";
import { TelegramSceneButtons } from "./telegram-scene-buttons.js";
import { TelegramSceneSlots } from "./telegram-scene-slots.js";
import {
    TelegramSceneInstance,
    TelegramSceneStorage,
} from "./telegram-scene-storage.js";
import { TelegramSceneControl } from "./telegram-scene.js";

export type TelegramSceneControlFactory = (
    instance: TelegramSceneInstance,
    slotMessageId?: number,
) => TelegramSceneControl<Record<string, unknown>>;

export class TelegramSceneUpdate {
    readonly storage: TelegramSceneStorage;
    private readonly touched = new Map<
        TelegramSceneInstance,
        { reshow: boolean }
    >();
    private commandMessageId?: number;

    constructor(storage: TelegramSceneStorage) {
        this.storage = storage;
    }

    touch(
        instance: TelegramSceneInstance,
        { reshow = false }: { reshow?: boolean } = {},
    ): void {
        this.touched.set(instance, {
            reshow: reshow || !!this.touched.get(instance)?.reshow,
        });
    }

    removeCommandMessage(update: Update | undefined): void {
        if (update?.message && extractTelegramCommand(update)) {
            this.commandMessageId = update.message.message_id;
        }
    }

    rememberButtons(
        buttons: TelegramSceneButtons,
        change: TelegramMessageChange,
    ): void {
        for (const instance of this.storage.loaded) {
            buttons.remember(instance, change.messageId, change.markup);
        }
    }

    async render(
        ctx: TelegramContext,
        slots: TelegramSceneSlots,
        controlOf: TelegramSceneControlFactory,
    ): Promise<void> {
        for (const [instance, { reshow }] of this.touched) {
            if (this.storage.has(instance)) {
                await slots.render(
                    ctx,
                    instance,
                    (slotMessageId) => controlOf(instance, slotMessageId),
                    { reshow },
                );
            }
        }

        if (this.commandMessageId !== undefined) {
            await ctx.deleteMessage(this.commandMessageId);
        }
    }

    save(): void {
        for (const instance of this.touched.keys()) {
            this.storage.save(instance);
        }
    }
}
