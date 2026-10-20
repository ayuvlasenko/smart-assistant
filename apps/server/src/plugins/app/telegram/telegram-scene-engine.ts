import { Update } from "@grammyjs/types";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { TelegramContext } from "./telegram-context.js";
import { extractTelegramCommand } from "./telegram-extractors.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import {
    parseTelegramButtonPress,
    TelegramButton,
    TelegramSceneButtons,
} from "./telegram-scene-buttons.js";
import { TelegramSceneInputs } from "./telegram-scene-inputs.js";
import {
    TelegramSceneMessages,
    TelegramSceneMessagesRelease,
} from "./telegram-scene-messages.js";
import { TelegramScenePresses } from "./telegram-scene-presses.js";
import {
    TelegramSceneScreens,
    TelegramScreenState,
} from "./telegram-scene-screens.js";
import {
    TelegramSceneInstance,
    TelegramSceneStorage,
} from "./telegram-scene-storage.js";
import { TelegramSceneUpdate } from "./telegram-scene-update.js";
import { TelegramScene, TelegramSceneControl } from "./telegram-scene.js";
import { TelegramSession } from "./telegram-session.js";

type SceneState = Record<string, unknown>;
type SceneControl = TelegramSceneControl<SceneState>;

export class TelegramSceneEngine {
    private readonly scenes = new Map<string, TelegramScene>();
    private readonly updates = new WeakMap<
        TelegramSession,
        TelegramSceneUpdate
    >();
    private readonly buttons = new TelegramSceneButtons();
    private readonly inputs: TelegramSceneInputs;
    private readonly presses: TelegramScenePresses;
    private readonly screens = new TelegramSceneScreens();
    private readonly messages = new TelegramSceneMessages();
    private readonly telegramMetrics: TelegramMetrics;

    constructor(telegramMetrics: TelegramMetrics) {
        this.telegramMetrics = telegramMetrics;

        this.inputs = new TelegramSceneInputs(telegramMetrics, this.buttons);
        this.presses = new TelegramScenePresses(
            telegramMetrics,
            this.buttons,
            this.inputs,
            this.screens,
            (ctx, instance) => this.sceneControl(ctx, instance),
        );
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
        if (!this.canEnter(ctx, scene)) {
            return false;
        }

        const storage = this.updateFor(ctx).storage;
        const id = await this.instanceIdFor(storage, scene, state);

        if (!(await this.canStart(ctx, scene, id))) {
            return false;
        }

        const existing = await storage.load(id);

        if (existing) {
            this.updateFor(ctx).touch(existing, { reshow: true });
        } else {
            await this.create(ctx, scene, id, state);
        }

        this.updateFor(ctx).removeCommandMessage(ctx.update);

        return true;
    }

    async cancel(ctx: TelegramContext): Promise<boolean> {
        const blocker = await this.updateFor(ctx).storage.blocking();

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
            return this.presses.handle(
                ctx,
                await this.updateFor(ctx).storage.load(press.sceneId),
                press,
            );
        }

        const instance = await this.focusedInput(ctx);

        if (instance && !this.inputs.canUse(instance, ctx.user)) {
            return next();
        }

        if (instance && this.inputs.accepts(instance, ctx.update)) {
            return this.inputs.handleMessage(
                ctx,
                this.sceneControl(ctx, instance),
                instance,
            );
        }

        if (instance && isUnexpectedInput(ctx.update)) {
            this.updateFor(ctx).touch(instance);
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
        const storage = this.updateFor(ctx).storage;
        const instance = await storage.load(storage.idForKey(scene, key));

        if (instance?.scene !== scene || !isAllowed(scene.guard, ctx.user)) {
            return false;
        }

        this.telegramMetrics.recordSceneEvent(scene.name, "delivered");
        await handle(this.sceneControl(ctx, instance));

        return true;
    }

    async redraw(
        ctx: TelegramContext,
        sceneId: string,
        topics: readonly string[],
    ): Promise<boolean> {
        const instance = await this.updateFor(ctx).storage.load(sceneId);

        if (
            !instance?.record.topics.some((topic) => topics.includes(topic)) ||
            !isAllowed(instance.scene.guard, ctx.user)
        ) {
            return false;
        }

        this.telegramMetrics.recordSceneEvent(instance.scene.name, "delivered");
        this.updateFor(ctx).touch(instance);

        return true;
    }

    async withScenes<T>(
        ctx: TelegramContext,
        action: () => Promise<T>,
    ): Promise<T> {
        const update = this.updateFor(ctx);
        const stopRecording = ctx.events.on(
            ["messageSent", "messageEdited", "messageRemoved"],
            ({ data }) => {
                update.rememberButtons(this.buttons, data);
            },
        );

        try {
            const result = await action();

            await update.render(ctx, (instance, reshow) =>
                this.render(ctx, instance, reshow),
            );

            return result;
        } finally {
            stopRecording();
            update.save();
        }
    }

    private async render(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        reshow: boolean,
    ): Promise<void> {
        if (!instance.scene.root) {
            return;
        }

        const contents = await this.screens.render(
            ctx,
            instance,
            this.sceneControl(ctx, instance),
        );

        await this.messages.render(ctx, instance, contents, { reshow });
    }

    private canEnter(ctx: TelegramContext, scene: TelegramScene): boolean {
        if (this.scenes.get(scene.name) !== scene) {
            throw new Error(`Telegram scene "${scene.name}" is not registered`);
        }

        if (!isAllowed(scene.guard, ctx.user)) {
            this.recordForbidden(ctx, scene);
            return false;
        }

        return true;
    }

    private async create(
        ctx: TelegramContext,
        scene: TelegramScene,
        id: string,
        state: SceneState,
    ): Promise<TelegramSceneInstance> {
        const instance = this.updateFor(ctx).storage.create(id, scene, state);

        this.telegramMetrics.recordSceneEvent(scene.name, "start");
        ctx.log.info(
            { scene: scene.name, sceneId: id },
            "Telegram scene started",
        );

        await scene.start(ctx, this.sceneControl(ctx, instance));

        return instance;
    }

    private async handOver(
        ctx: TelegramContext,
        source: TelegramSceneInstance,
        scene: TelegramScene,
        state: SceneState,
    ): Promise<boolean> {
        if (!this.canEnter(ctx, scene)) {
            return false;
        }

        const storage = this.updateFor(ctx).storage;
        const id = await this.instanceIdFor(storage, scene, state);

        if (id === source.id) {
            throw new Error(
                `Telegram scene "${scene.name}" cannot hand its messages over to itself`,
            );
        }

        if (!(await this.canStart(ctx, scene, id, source))) {
            return false;
        }

        const target =
            (await storage.load(id)) ??
            (await this.create(ctx, scene, id, state));

        await this.messages.handOver(ctx, source, target);
        await this.inputs.cancel(ctx, this.sceneControl(ctx, source), source, {
            silent: true,
        });
        source.record.confirming = undefined;
        await this.end(ctx, source, "keep", target);
        this.updateFor(ctx).touch(target);

        return true;
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
        source?: TelegramSceneInstance,
    ): Promise<boolean> {
        const blocker = await this.updateFor(ctx).storage.blocking();

        if (blocker && blocker.id !== id && blocker.id !== source?.id) {
            await this.rejectBlocked(ctx, scene, blocker, scene.title?.(ctx.t));
            return false;
        }

        const focused = scene.blocking
            ? await this.focusedInput(ctx)
            : undefined;

        if (focused && focused.id !== id && focused.id !== source?.id) {
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

        await ctx.notify(this.blockedText(ctx, blocker, nextTitle));
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

        if (this.updateFor(ctx).storage.has(instance)) {
            await this.end(ctx, instance, "removeButtons");
        }

        if (!isInputCancelled) {
            await ctx.reply(ctx.t("telegram:sceneCancelled"));
        }
    }

    private async end(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        messages: TelegramSceneMessagesRelease,
        handedOverTo?: TelegramSceneInstance,
    ): Promise<void> {
        await this.messages.release(ctx, instance, messages);
        this.updateFor(ctx).storage.remove(instance);
        this.telegramMetrics.recordSceneEvent(instance.scene.name, "end");
        ctx.log.info(
            {
                scene: instance.scene.name,
                sceneId: instance.id,
                handedOverTo: handedOverTo?.id,
            },
            "Telegram scene ended",
        );
    }

    private async focusedInput(
        ctx: TelegramContext,
    ): Promise<TelegramSceneInstance | undefined> {
        const instance = await this.updateFor(ctx).storage.focused();

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
        this.updateFor(ctx).touch(instance);
    }

    private async ask(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        name: string,
    ): Promise<void> {
        if (
            !isAllowed(instance.scene.guard, ctx.user) ||
            !isAllowed(instance.scene.inputs[name]?.guard, ctx.user)
        ) {
            this.recordForbidden(ctx, instance.scene);
            return;
        }

        const blocker = await this.updateFor(ctx).storage.blocking();

        if (blocker && blocker.id !== instance.id) {
            await this.rejectBlocked(ctx, instance.scene, blocker);
            return;
        }

        const focused = await this.focusedInput(ctx);

        if (focused && focused.id !== instance.id) {
            await ctx.notify(ctx.t("telegram:inputBusy"));
            return;
        }

        await this.inputs.start(
            ctx,
            this.sceneControl(ctx, instance),
            instance,
            name,
        );
    }

    private recordForbidden(ctx: TelegramContext, scene: TelegramScene): void {
        this.telegramMetrics.recordSceneEvent(scene.name, "forbidden");
        ctx.log.info({ scene: scene.name }, "Telegram scene is forbidden");
    }

    private sceneControl(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
    ): SceneControl {
        this.updateFor(ctx).touch(instance);

        const button = (text: string, data: TelegramButton) =>
            this.buttons.create(instance, text, data);
        const screenOf = (
            name: string,
            params: [] | [Record<string, unknown>],
        ): TelegramScreenState => ({ name, params: params[0] ?? {} });
        const screens = this.screens;

        return {
            id: instance.id,
            name: instance.scene.name,
            state: instance.record.state,
            get screen() {
                return screens.of(instance);
            },
            button: (text, name, value) =>
                button(text, { kind: "scene", name, value }),
            screenButton: (text, name, ...params) =>
                button(text, {
                    kind: "screen",
                    screen: screenOf(name, params),
                }),
            backButton: (text) => button(text, { kind: "back" }),
            isConfirming: (name, ...value) =>
                this.buttons.isConfirming(instance, name, ...value),
            push: (name, ...params) => {
                const screen = screenOf(name, params);

                return this.navigate(ctx, instance, screen, () => {
                    screens.push(instance, screen);
                });
            },
            replace: (name, ...params) => {
                const screen = screenOf(name, params);

                return this.navigate(ctx, instance, screen, () => {
                    screens.replace(instance, screen);
                });
            },
            back: () =>
                this.navigate(ctx, instance, undefined, () => {
                    screens.back(instance);
                }),
            reset: () =>
                this.navigate(ctx, instance, undefined, () => {
                    screens.reset(instance);
                }),
            ask: (name) => this.ask(ctx, instance, name),
            end: (options) =>
                this.end(ctx, instance, options?.messages ?? "keep"),
            handOver: (scene, state) =>
                this.handOver(ctx, instance, scene, state),
        };
    }

    private async navigate(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        target: TelegramScreenState | undefined,
        move: () => void,
    ): Promise<void> {
        if (target && !this.screens.canShow(instance, ctx.user, target)) {
            this.recordForbidden(ctx, instance.scene);
            return;
        }

        await this.inputs.cancel(
            ctx,
            this.sceneControl(ctx, instance),
            instance,
            { silent: true },
        );
        instance.record.confirming = undefined;
        move();
    }

    private updateFor(ctx: TelegramContext): TelegramSceneUpdate {
        let update = this.updates.get(ctx.session);

        if (!update) {
            update = new TelegramSceneUpdate(
                new TelegramSceneStorage(
                    ctx.session,
                    (name) => this.scenes.get(name),
                    this.screens,
                    ctx.log,
                ),
            );
            this.updates.set(ctx.session, update);
        }

        return update;
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
