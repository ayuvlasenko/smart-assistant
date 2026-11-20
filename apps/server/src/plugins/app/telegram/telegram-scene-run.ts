import { Update } from "@grammyjs/types";
import { TelegramContext, TelegramMessageChange } from "./telegram-context.js";
import { extractTelegramCommand } from "./telegram-extractors.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import {
    TelegramButton,
    TelegramSceneButtons,
} from "./telegram-scene-buttons.js";
import { TelegramSceneInputs } from "./telegram-scene-inputs.js";
import {
    TelegramSceneMessages,
    TelegramSceneMessagesRelease,
} from "./telegram-scene-messages.js";
import {
    TelegramSceneScreens,
    TelegramScreenState,
} from "./telegram-scene-screens.js";
import {
    TelegramSceneInstance,
    TelegramSceneStorage,
} from "./telegram-scene-storage.js";
import { TelegramScene, TelegramSceneControl } from "./telegram-scene.js";

type SceneState = Record<string, unknown>;
type SceneControl = TelegramSceneControl<SceneState>;

export type TelegramSceneLookup = (name: string) => TelegramScene | undefined;

export class TelegramSceneRun {
    readonly ctx: TelegramContext;
    readonly storage: TelegramSceneStorage;
    private readonly touched = new Map<
        TelegramSceneInstance,
        { reshow: boolean }
    >();
    private commandMessageId?: number;
    private readonly findScene: TelegramSceneLookup;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly buttons: TelegramSceneButtons;
    private readonly inputs: TelegramSceneInputs;
    private readonly screens: TelegramSceneScreens;
    private readonly messages: TelegramSceneMessages;

    constructor(
        ctx: TelegramContext,
        findScene: TelegramSceneLookup,
        telegramMetrics: TelegramMetrics,
        buttons: TelegramSceneButtons,
        inputs: TelegramSceneInputs,
        screens: TelegramSceneScreens,
        messages: TelegramSceneMessages,
    ) {
        this.ctx = ctx;
        this.findScene = findScene;
        this.telegramMetrics = telegramMetrics;
        this.buttons = buttons;
        this.inputs = inputs;
        this.screens = screens;
        this.messages = messages;
        this.storage = new TelegramSceneStorage(
            ctx.session,
            findScene,
            screens,
            ctx.log,
        );
    }

    touch(
        instance: TelegramSceneInstance,
        { reshow = false }: { reshow?: boolean } = {},
    ): void {
        this.touched.set(instance, {
            reshow: reshow || !!this.touched.get(instance)?.reshow,
        });
    }

    async start(scene: TelegramScene, state: SceneState): Promise<boolean> {
        if (!(await this.canEnter(scene))) {
            return false;
        }

        const id = await this.instanceIdFor(scene, state);

        if (!(await this.canStart(scene, id))) {
            return false;
        }

        const existing = await this.storage.load(id);

        if (existing) {
            this.touch(existing, { reshow: true });
        } else {
            await this.create(scene, id, state);
        }

        this.deleteCommandAfterRender();

        return true;
    }

    async cancel(): Promise<boolean> {
        const blocker = await this.storage.blocking();

        if (blocker) {
            await this.cancelScene(blocker);
            return true;
        }

        const instance = await this.focusedInput();

        if (!instance) {
            return false;
        }

        this.touch(instance);

        return this.inputs.cancel(this.ctx, this.control(instance), instance);
    }

    async handleMessage(
        ctx: TelegramContext<Update>,
        next: () => Promise<void>,
    ): Promise<void> {
        const instance = await this.focusedInput();

        if (!instance || !(await this.inputs.canUse(instance, ctx.user))) {
            return next();
        }

        if (this.inputs.accepts(instance, ctx.update)) {
            this.touch(instance);
            return this.inputs.handleMessage(
                ctx,
                this.control(instance),
                instance,
            );
        }

        if (isUnexpectedInput(ctx.update)) {
            this.touch(instance);
            return this.inputs.replyUnexpected(ctx, instance);
        }

        return next();
    }

    async deliver(
        scene: TelegramScene,
        key: string,
        handle: (scene: SceneControl) => Promise<unknown>,
    ): Promise<boolean> {
        const instance = await this.storage.load(
            this.storage.idForKey(scene, key),
        );

        if (
            instance?.scene !== scene ||
            !(await isAllowed(scene.guard, this.ctx.user))
        ) {
            return false;
        }

        this.telegramMetrics.recordSceneEvent(scene.name, "delivered");
        this.touch(instance);
        await handle(this.control(instance));

        return true;
    }

    async redraw(sceneId: string, topics: readonly string[]): Promise<boolean> {
        const instance = await this.storage.load(sceneId);

        if (
            !instance?.record.topics.some((topic) => topics.includes(topic)) ||
            !(await isAllowed(instance.scene.guard, this.ctx.user))
        ) {
            return false;
        }

        this.telegramMetrics.recordSceneEvent(instance.scene.name, "delivered");
        this.touch(instance);

        return true;
    }

    rememberButtons({ messageId, markup }: TelegramMessageChange): void {
        for (const instance of this.storage.loaded) {
            this.buttons.remember(instance, messageId, markup);
        }
    }

    async render(): Promise<void> {
        for (const [instance, { reshow }] of this.touched) {
            if (this.storage.has(instance)) {
                await this.renderScene(instance, reshow);
            }
        }

        if (this.commandMessageId !== undefined) {
            await this.ctx.deleteMessage(this.commandMessageId);
        }
    }

    save(): void {
        for (const instance of this.touched.keys()) {
            this.storage.save(instance);
        }
    }

    control(instance: TelegramSceneInstance): SceneControl {
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

                return this.navigate(instance, screen, () => {
                    screens.push(instance, screen);
                });
            },
            replace: (name, ...params) => {
                const screen = screenOf(name, params);

                return this.navigate(instance, screen, () => {
                    screens.replace(instance, screen);
                });
            },
            back: () =>
                this.navigate(instance, undefined, () => {
                    screens.back(instance);
                }),
            reset: () =>
                this.navigate(instance, undefined, () => {
                    screens.reset(instance);
                }),
            ask: (name) => this.ask(instance, name),
            end: (options) => this.end(instance, options?.messages ?? "keep"),
            handOver: (scene, state) => this.handOver(instance, scene, state),
        };
    }

    private deleteCommandAfterRender(): void {
        const { update } = this.ctx;

        if (update?.message && extractTelegramCommand(update)) {
            this.commandMessageId = update.message.message_id;
        }
    }

    private async renderScene(
        instance: TelegramSceneInstance,
        reshow: boolean,
    ): Promise<void> {
        if (!instance.scene.root) {
            return;
        }

        const contents = await this.screens.render(
            this.ctx,
            instance,
            this.control(instance),
        );

        await this.messages.render(this.ctx, instance, contents, { reshow });
    }

    private async canEnter(scene: TelegramScene): Promise<boolean> {
        if (this.findScene(scene.name) !== scene) {
            throw new Error(`Telegram scene "${scene.name}" is not registered`);
        }

        if (!(await isAllowed(scene.guard, this.ctx.user))) {
            this.recordForbidden(scene);
            return false;
        }

        return true;
    }

    private async create(
        scene: TelegramScene,
        id: string,
        state: SceneState,
    ): Promise<TelegramSceneInstance> {
        const instance = this.storage.create(id, scene, state);

        this.touch(instance);
        this.telegramMetrics.recordSceneEvent(scene.name, "start");
        this.ctx.log.info(
            { scene: scene.name, sceneId: id },
            "Telegram scene started",
        );

        await scene.start(this.ctx, this.control(instance));

        return instance;
    }

    private async handOver(
        source: TelegramSceneInstance,
        scene: TelegramScene,
        state: SceneState,
    ): Promise<boolean> {
        if (!(await this.canEnter(scene))) {
            return false;
        }

        const id = await this.instanceIdFor(scene, state, source);

        if (id === source.id) {
            throw new Error(
                `Telegram scene "${scene.name}" cannot hand its messages over to itself`,
            );
        }

        if (!(await this.canStart(scene, id, source))) {
            return false;
        }

        await this.inputs.cancel(this.ctx, this.control(source), source, {
            silent: true,
        });
        await this.end(source, "keep", id);

        const target =
            (await this.storage.load(id)) ??
            (await this.create(scene, id, state));

        this.touch(target);
        await this.messages.handOver(this.ctx, source, target);

        return true;
    }

    private async instanceIdFor(
        scene: TelegramScene,
        state: SceneState,
        source?: TelegramSceneInstance,
    ): Promise<string> {
        const blocker = await this.storage.blocking();

        return blocker?.scene === scene &&
            blocker.id !== source?.id &&
            scene.key(state) === undefined
            ? blocker.id
            : this.storage.idFor(scene, state);
    }

    private canStart(
        scene: TelegramScene,
        id: string,
        source?: TelegramSceneInstance,
    ): Promise<boolean> {
        return this.admit(scene, [id, source?.id], {
            checkFocus: !!scene.blocking,
            nextTitle: scene.title?.(this.ctx.t),
        });
    }

    private async admit(
        scene: TelegramScene,
        ownIds: (string | undefined)[],
        { checkFocus, nextTitle }: { checkFocus: boolean; nextTitle?: string },
    ): Promise<boolean> {
        const blocker = await this.storage.blocking();

        if (blocker && !ownIds.includes(blocker.id)) {
            await this.rejectBlocked(scene, blocker, nextTitle);
            return false;
        }

        const focused = checkFocus ? await this.focusedInput() : undefined;

        if (focused && !ownIds.includes(focused.id)) {
            await this.rejectBlocked(scene, focused);
            return false;
        }

        return true;
    }

    private async rejectBlocked(
        scene: TelegramScene,
        blocker: TelegramSceneInstance,
        nextTitle?: string,
    ): Promise<void> {
        this.telegramMetrics.recordSceneEvent(scene.name, "blocked");
        this.ctx.log.info(
            {
                scene: scene.name,
                blockedBy: blocker.scene.name,
                blockedBySceneId: blocker.id,
            },
            "Telegram scene is blocked",
        );

        await this.ctx.notify(this.blockedText(blocker, nextTitle));
    }

    private blockedText(
        blocker: TelegramSceneInstance,
        nextTitle: string | undefined,
    ): string {
        const { t } = this.ctx;

        if (!blocker.scene.blocking) {
            return t("telegram:inputBusy");
        }

        const current = blocker.scene.title(t);

        return nextTitle === undefined
            ? t("telegram:sceneBlocked", { current })
            : t("telegram:sceneBlockedStart", { current, next: nextTitle });
    }

    private async cancelScene(instance: TelegramSceneInstance): Promise<void> {
        this.touch(instance);

        const isInputCancelled = await this.inputs.cancel(
            this.ctx,
            this.control(instance),
            instance,
        );

        if (this.storage.has(instance)) {
            await this.end(instance, "removeButtons");
        }

        if (!isInputCancelled) {
            await this.ctx.reply(this.ctx.t("telegram:sceneCancelled"));
        }
    }

    private async end(
        instance: TelegramSceneInstance,
        messages: TelegramSceneMessagesRelease,
        handedOverTo?: string,
    ): Promise<void> {
        await this.messages.release(this.ctx, instance, messages);
        this.storage.remove(instance);
        this.telegramMetrics.recordSceneEvent(instance.scene.name, "end");
        this.ctx.log.info(
            {
                scene: instance.scene.name,
                sceneId: instance.id,
                handedOverTo,
            },
            "Telegram scene ended",
        );
    }

    private async focusedInput(): Promise<TelegramSceneInstance | undefined> {
        const instance = await this.storage.focused();

        if (!instance || this.inputs.isActive(instance)) {
            return instance;
        }

        this.ctx.log.warn(
            {
                scene: instance.scene.name,
                sceneId: instance.id,
                input: instance.record.input?.name,
            },
            "Telegram scene input is no longer registered, dropping it",
        );
        this.inputs.abort(instance);
        this.touch(instance);
    }

    private async ask(
        instance: TelegramSceneInstance,
        name: string,
    ): Promise<void> {
        const { user } = this.ctx;

        if (
            !(await isAllowed(instance.scene.guard, user)) ||
            !(await isAllowed(instance.scene.inputs[name]?.guard, user))
        ) {
            this.recordForbidden(instance.scene);
            return;
        }

        if (
            !(await this.admit(instance.scene, [instance.id], {
                checkFocus: true,
            }))
        ) {
            return;
        }

        await this.inputs.start(
            this.ctx,
            this.control(instance),
            instance,
            name,
        );
    }

    private recordForbidden(scene: TelegramScene): void {
        this.telegramMetrics.recordSceneEvent(scene.name, "forbidden");
        this.ctx.log.info({ scene: scene.name }, "Telegram scene is forbidden");
    }

    private async navigate(
        instance: TelegramSceneInstance,
        target: TelegramScreenState | undefined,
        move: () => void,
    ): Promise<void> {
        if (
            target &&
            !(await this.screens.canShow(instance, this.ctx.user, target))
        ) {
            this.recordForbidden(instance.scene);
            return;
        }

        await this.inputs.cancel(this.ctx, this.control(instance), instance, {
            silent: true,
        });
        this.buttons.cancelConfirmation(instance);
        move();
    }
}

function isUnexpectedInput(update: Update): boolean {
    return !!update.message && !extractTelegramCommand(update);
}
