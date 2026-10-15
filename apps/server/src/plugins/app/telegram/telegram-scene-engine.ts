import { Update } from "@grammyjs/types";
import { Value } from "@sinclair/typebox/value";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { TelegramContext, TelegramMessageChange } from "./telegram-context.js";
import { extractTelegramCommand } from "./telegram-extractors.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import {
    parseTelegramButtonPress,
    TelegramButtonPress,
    TelegramSceneButtons,
} from "./telegram-scene-buttons.js";
import { TelegramSceneInputs } from "./telegram-scene-inputs.js";
import {
    TelegramSceneSlots,
    TelegramSlotMessages,
} from "./telegram-scene-slots.js";
import {
    TelegramSceneInstance,
    TelegramSceneStorage,
} from "./telegram-scene-storage.js";
import { TelegramScene, TelegramSceneControl } from "./telegram-scene.js";
import { TelegramSession } from "./telegram-session.js";

type SceneState = Record<string, unknown>;
type SceneControl = TelegramSceneControl<SceneState>;

export class TelegramSceneEngine {
    private readonly scenes = new Map<string, TelegramScene>();
    private readonly storages = new WeakMap<
        TelegramSession,
        TelegramSceneStorage
    >();
    private readonly buttons = new TelegramSceneButtons();
    private readonly inputs: TelegramSceneInputs;
    private readonly slots = new TelegramSceneSlots();
    private readonly touched = new WeakMap<
        TelegramSession,
        Map<TelegramSceneInstance, { reshow: boolean }>
    >();
    private readonly telegramMetrics: TelegramMetrics;

    constructor(telegramMetrics: TelegramMetrics) {
        this.telegramMetrics = telegramMetrics;

        this.inputs = new TelegramSceneInputs(telegramMetrics, this.buttons);
    }

    register(scene: TelegramScene): void {
        if (this.scenes.has(scene.name)) {
            throw new Error(
                `Telegram scene "${scene.name}" is already registered`,
            );
        }

        for (const [name, input] of Object.entries(scene.inputs)) {
            if (!input.steps.length) {
                throw new Error(
                    `Telegram scene "${scene.name}" input "${name}" has no steps`,
                );
            }

            if (
                new Set(input.steps.map((step) => step.name)).size !==
                input.steps.length
            ) {
                throw new Error(
                    `Telegram scene "${scene.name}" input "${name}" has duplicate step names`,
                );
            }
        }

        this.scenes.set(scene.name, scene);
    }

    async start(
        ctx: TelegramContext,
        scene: TelegramScene,
        state: SceneState,
    ): Promise<boolean> {
        if (this.scenes.get(scene.name) !== scene) {
            throw new Error(`Telegram scene "${scene.name}" is not registered`);
        }

        const storage = this.storageFor(ctx);
        const id = await this.instanceIdFor(storage, scene, state);

        if (!(await this.canStart(ctx, scene, id))) {
            return false;
        }

        const existing = await storage.load(id);

        if (existing) {
            this.touch(ctx, existing, { reshow: true });
            return true;
        }

        const instance = storage.create(id, scene, state);

        this.telegramMetrics.recordSceneEvent(scene.name, "start");
        ctx.log.info(
            { scene: scene.name, sceneId: id },
            "Telegram scene started",
        );

        await scene.start(ctx, this.sceneControl(ctx, instance));

        return true;
    }

    async cancel(ctx: TelegramContext): Promise<boolean> {
        const blocker = await this.storageFor(ctx).blocking();

        if (blocker) {
            await this.cancelScene(ctx, blocker);
            return true;
        }

        const instance = await this.focusedInput(ctx);

        if (!instance) {
            return false;
        }

        return this.inputs.cancel(
            ctx,
            this.sceneControl(ctx, instance),
            instance,
        );
    }

    async handle(
        ctx: TelegramContext<Update>,
        next: () => Promise<void>,
    ): Promise<void> {
        const press = parseTelegramButtonPress(ctx.update);

        if (press) {
            return this.handlePress(ctx, press);
        }

        const instance = await this.focusedInput(ctx);

        if (instance && this.inputs.accepts(instance, ctx.update)) {
            return this.inputs.handleMessage(
                ctx,
                this.sceneControl(ctx, instance),
                instance,
            );
        }

        if (instance && isUnexpectedInput(ctx.update)) {
            this.touch(ctx, instance);
            return this.inputs.replyUnexpected(ctx, instance);
        }

        return next();
    }

    async deliver(
        ctx: TelegramContext,
        scene: TelegramScene,
        key: string,
        handle: (scene: SceneControl) => Promise<unknown>,
    ): Promise<boolean> {
        const storage = this.storageFor(ctx);
        const instance = await storage.load(storage.idForKey(scene, key));

        if (instance?.scene !== scene) {
            return false;
        }

        this.telegramMetrics.recordSceneEvent(scene.name, "delivered");
        await handle(this.sceneControl(ctx, instance));

        return true;
    }

    async withScenes<T>(
        ctx: TelegramContext,
        action: () => Promise<T>,
    ): Promise<T> {
        const stopRecording = ctx.events.on(
            ["messageSent", "messageEdited", "messageRemoved"],
            ({ data }) => {
                this.recordButtons(ctx, data);
            },
        );

        try {
            const result = await action();

            await this.renderTouched(ctx);

            return result;
        } finally {
            stopRecording();
            this.saveTouched(ctx);
        }
    }

    private async instanceIdFor(
        storage: TelegramSceneStorage,
        scene: TelegramScene,
        state: SceneState,
    ): Promise<string> {
        const blocker = await storage.blocking();

        return blocker?.scene === scene && scene.key(state) === undefined
            ? blocker.id
            : storage.idFor(scene, state);
    }

    private async canStart(
        ctx: TelegramContext,
        scene: TelegramScene,
        id: string,
    ): Promise<boolean> {
        const blocker = await this.storageFor(ctx).blocking();

        if (blocker && blocker.id !== id) {
            await this.rejectBlocked(ctx, scene, blocker, scene.title?.(ctx.t));
            return false;
        }

        const focused = scene.blocking
            ? await this.focusedInput(ctx)
            : undefined;

        if (focused && focused.id !== id) {
            await this.rejectBlocked(ctx, scene, focused);
            return false;
        }

        return true;
    }

    private async rejectBlocked(
        ctx: TelegramContext,
        scene: TelegramScene,
        blocker: TelegramSceneInstance,
        nextTitle?: string,
    ): Promise<void> {
        this.telegramMetrics.recordSceneEvent(scene.name, "blocked");
        ctx.log.info(
            {
                scene: scene.name,
                blockedBy: blocker.scene.name,
                blockedBySceneId: blocker.id,
            },
            "Telegram scene is blocked",
        );

        await ctx.reply(this.blockedText(ctx, blocker, nextTitle));
    }

    private blockedText(
        ctx: TelegramContext,
        blocker: TelegramSceneInstance,
        nextTitle: string | undefined,
    ): string {
        if (!blocker.scene.blocking) {
            return ctx.t("telegram:inputBusy");
        }

        const current = blocker.scene.title(ctx.t);

        return nextTitle === undefined
            ? ctx.t("telegram:sceneBlocked", { current })
            : ctx.t("telegram:sceneBlockedStart", { current, next: nextTitle });
    }

    private async cancelScene(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
    ): Promise<void> {
        const isInputCancelled = await this.inputs.cancel(
            ctx,
            this.sceneControl(ctx, instance),
            instance,
        );

        if (this.storageFor(ctx).has(instance)) {
            await this.end(ctx, instance, "removeButtons");
        }

        if (!isInputCancelled) {
            await ctx.reply(ctx.t("telegram:sceneCancelled"));
        }
    }

    private async handlePress(
        ctx: TelegramContext<Update>,
        press: TelegramButtonPress,
    ): Promise<void> {
        const instance = await this.storageFor(ctx).load(press.sceneId);
        const button = instance && this.buttons.find(instance, press);

        if (!instance || !button) {
            return this.rejectExpiredButton(ctx, "unknown");
        }

        if (button.kind === "input") {
            const isHandled = await this.inputs.handleButton(
                ctx,
                this.sceneControl(ctx, instance),
                instance,
                button.step,
                button.value,
            );

            if (!isHandled) {
                return this.rejectExpiredButton(
                    ctx,
                    `${instance.scene.name}:input`,
                );
            }

            this.recordPress(instance, "input");
            return;
        }

        const definition = instance.scene.buttons[button.name];
        const action = `${instance.scene.name}:${button.name}`;

        if (!definition || !Value.Check(definition.value, button.value)) {
            return this.rejectExpiredButton(ctx, action);
        }

        await definition.handle(
            ctx,
            this.sceneControl(ctx, instance),
            button.value,
        );
        this.recordPress(instance, button.name);
    }

    private async renderTouched(ctx: TelegramContext): Promise<void> {
        const storage = this.storageFor(ctx);

        for (const [instance, { reshow }] of this.touchedIn(ctx)) {
            if (storage.has(instance)) {
                await this.slots.render(
                    ctx,
                    instance,
                    (slotMessageId) =>
                        this.sceneControl(ctx, instance, slotMessageId),
                    { reshow },
                );
            }
        }
    }

    private recordButtons(
        ctx: TelegramContext,
        change: TelegramMessageChange,
    ): void {
        for (const instance of this.storageFor(ctx).loaded) {
            this.buttons.remember(instance, change.messageId, change.markup);
        }
    }

    private saveTouched(ctx: TelegramContext): void {
        const storage = this.storageFor(ctx);

        for (const instance of this.touchedIn(ctx).keys()) {
            storage.save(instance);
        }
    }

    private touch(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        { reshow = false }: { reshow?: boolean } = {},
    ): void {
        const touched = this.touchedIn(ctx);

        touched.set(instance, {
            reshow: reshow || !!touched.get(instance)?.reshow,
        });
    }

    private touchedIn(
        ctx: TelegramContext,
    ): Map<TelegramSceneInstance, { reshow: boolean }> {
        let touched = this.touched.get(ctx.session);

        if (!touched) {
            touched = new Map();
            this.touched.set(ctx.session, touched);
        }

        return touched;
    }

    private async end(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        messages: TelegramSlotMessages,
    ): Promise<void> {
        await this.slots.release(ctx, instance, messages);
        this.storageFor(ctx).remove(instance);
        this.telegramMetrics.recordSceneEvent(instance.scene.name, "end");
        ctx.log.info(
            { scene: instance.scene.name, sceneId: instance.id },
            "Telegram scene ended",
        );
    }

    private async focusedInput(
        ctx: TelegramContext,
    ): Promise<TelegramSceneInstance | undefined> {
        const instance = await this.storageFor(ctx).focused();

        if (!instance || this.inputs.isActive(instance)) {
            return instance;
        }

        ctx.log.warn(
            {
                scene: instance.scene.name,
                sceneId: instance.id,
                input: instance.record.input?.name,
            },
            "Telegram scene input is no longer registered, dropping it",
        );
        this.inputs.abort(instance);
        this.touch(ctx, instance);
    }

    private async ask(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        name: string,
    ): Promise<void> {
        const blocker = await this.storageFor(ctx).blocking();

        if (blocker && blocker.id !== instance.id) {
            await this.rejectBlocked(ctx, instance.scene, blocker);
            return;
        }

        const focused = await this.focusedInput(ctx);

        if (focused && focused.id !== instance.id) {
            await ctx.reply(ctx.t("telegram:inputBusy"));
            return;
        }

        await this.inputs.start(
            ctx,
            this.sceneControl(ctx, instance),
            instance,
            name,
        );
    }

    private sceneControl(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        slotMessageId?: number,
    ): SceneControl {
        this.touch(ctx, instance);

        return {
            id: instance.id,
            name: instance.scene.name,
            state: instance.record.state,
            button: (text, name, value) =>
                this.buttons.create(
                    instance,
                    text,
                    { kind: "scene", name, value },
                    slotMessageId,
                ),
            ask: (name) => this.ask(ctx, instance, name),
            end: (options) =>
                this.end(ctx, instance, options?.messages ?? "keep"),
        };
    }

    private async rejectExpiredButton(
        ctx: TelegramContext<Update>,
        action: string,
    ): Promise<void> {
        this.telegramMetrics.recordButtonPress(action, "expired");
        ctx.log.info({ action }, "Telegram button is expired");

        await ctx.answerCallbackQuery(ctx.t("telegram:buttonExpired"));
    }

    private recordPress(instance: TelegramSceneInstance, button: string): void {
        this.telegramMetrics.recordButtonPress(
            `${instance.scene.name}:${button}`,
            "handled",
        );
    }

    private storageFor(ctx: TelegramContext): TelegramSceneStorage {
        let storage = this.storages.get(ctx.session);

        if (!storage) {
            storage = new TelegramSceneStorage(
                ctx.session,
                (name) => this.scenes.get(name),
                ctx.log,
            );
            this.storages.set(ctx.session, storage);
        }

        return storage;
    }
}

function isUnexpectedInput(update: Update): boolean {
    return !!update.message && !extractTelegramCommand(update);
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "telegramSceneEngine",
            new TelegramSceneEngine(
                fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
            ),
        );
    },
    {
        name: "telegram-scene-engine",
        dependencies: ["telegram-metrics"],
    },
);
