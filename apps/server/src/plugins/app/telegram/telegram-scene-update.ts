import { Update } from "@grammyjs/types";
import { TelegramContext } from "./telegram-context.js";
import { extractTelegramCommand } from "./telegram-extractors.js";
import {
    TelegramSceneInstance,
    TelegramSceneStorage,
} from "./telegram-scene-storage.js";

export type TelegramSceneRenderer = (
    instance: TelegramSceneInstance,
    reshow: boolean,
) => Promise<void>;

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

    deleteCommandAfterRender(update: Update | undefined): void {
        if (update?.message && extractTelegramCommand(update)) {
            this.commandMessageId = update.message.message_id;
        }
    }

    async render(
        ctx: TelegramContext,
        render: TelegramSceneRenderer,
    ): Promise<void> {
        for (const [instance, { reshow }] of this.touched) {
            if (this.storage.has(instance)) {
                await render(instance, reshow);
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
