import { Update } from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TelegramContext } from "./telegram-context.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { TelegramSceneButtons } from "./telegram-scene-buttons.js";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";
import {
    TelegramInputControl,
    TelegramSceneControl,
    TelegramSceneInput,
    TelegramStep,
    TelegramTransition,
} from "./telegram-scene.js";

export const telegramInputStateSchema = Type.Object({
    name: Type.String(),
    step: Type.String(),
    history: Type.Array(Type.String()),
    payload: Type.Record(Type.String(), Type.Unknown()),
    messageIds: Type.Array(Type.Number()),
});

type TelegramInputState = Static<typeof telegramInputStateSchema>;
type InputPayload = Record<string, unknown>;
type SceneControl = TelegramSceneControl<Record<string, unknown>>;

interface ActiveInput {
    input: TelegramSceneInput;
    step: TelegramStep<InputPayload>;
    state: TelegramInputState;
}

export class TelegramSceneInputs {
    private readonly telegramMetrics: TelegramMetrics;
    private readonly buttons: TelegramSceneButtons;

    constructor(
        telegramMetrics: TelegramMetrics,
        buttons: TelegramSceneButtons,
    ) {
        this.telegramMetrics = telegramMetrics;
        this.buttons = buttons;
    }

    isActive(instance: TelegramSceneInstance): boolean {
        return !!this.findActive(instance);
    }

    abort(instance: TelegramSceneInstance): void {
        instance.record.input = undefined;
        this.buttons.forgetInputButtons(instance);
    }

    accepts(instance: TelegramSceneInstance, update: Update): boolean {
        return (
            !update.callback_query &&
            !!this.findActive(instance)?.step.accepts(update)
        );
    }

    async start(
        ctx: TelegramContext,
        scene: SceneControl,
        instance: TelegramSceneInstance,
        name: string,
    ): Promise<void> {
        const input = instance.scene.inputs[name];
        const [firstStep] = input?.steps ?? [];

        if (!input || !firstStep) {
            throw new Error(
                `Telegram scene "${instance.scene.name}" has no input "${name}"`,
            );
        }

        const previous = this.findActive(instance);
        if (previous) {
            await this.finish(ctx, instance, previous);
        }

        const state: TelegramInputState = {
            name,
            step: firstStep.name,
            history: [],
            payload: {},
            messageIds: [],
        };

        instance.record.input = state;
        this.recordEvent(instance, "ask");
        ctx.log.info(
            { scene: instance.scene.name, sceneId: instance.id, input: name },
            "Telegram scene input started",
        );

        await this.run(instance, () =>
            this.enterStep(ctx, scene, instance, {
                input,
                step: firstStep,
                state,
            }),
        );
    }

    async handleMessage(
        ctx: TelegramContext<Update>,
        scene: SceneControl,
        instance: TelegramSceneInstance,
    ): Promise<void> {
        const active = this.requireActive(instance);

        await this.run(instance, () =>
            this.runStep(ctx, scene, instance, active, undefined),
        );
    }

    async handleButton(
        ctx: TelegramContext<Update>,
        scene: SceneControl,
        instance: TelegramSceneInstance,
        step: string,
        value: unknown,
    ): Promise<boolean> {
        const active = this.findActive(instance);

        if (active?.state.step !== step || !active.step.accepts(ctx.update)) {
            return false;
        }

        await this.run(instance, () =>
            this.runStep(ctx, scene, instance, active, value),
        );

        return true;
    }

    async replyUnexpected(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
    ): Promise<void> {
        const active = this.requireActive(instance);

        this.recordEvent(instance, "unexpected_input");
        this.track(active, ctx.update.message?.message_id);
        await this.trackingMessages(ctx, active, () =>
            ctx.reply(
                active.step.hint?.(ctx.t) ?? ctx.t("telegram:sceneUnexpected"),
            ),
        );
    }

    async cancel(
        ctx: TelegramContext,
        scene: SceneControl,
        instance: TelegramSceneInstance,
        { silent = false }: { silent?: boolean } = {},
    ): Promise<boolean> {
        const active = this.findActive(instance);

        if (!active) {
            return false;
        }

        await this.finish(ctx, instance, active);
        this.recordEvent(instance, "cancel");
        ctx.log.info(
            {
                scene: instance.scene.name,
                sceneId: instance.id,
                input: active.state.name,
                step: active.state.step,
            },
            "Telegram scene input cancelled",
        );

        if (silent) {
            return true;
        }

        if (active.input.cancel) {
            await active.input.cancel(ctx, scene);
        } else {
            await ctx.reply(ctx.t("telegram:sceneCancelled"));
        }

        return true;
    }

    private async run(
        instance: TelegramSceneInstance,
        action: () => Promise<void>,
    ): Promise<void> {
        try {
            await action();
        } catch (err) {
            this.abort(instance);
            this.recordEvent(instance, "error");
            throw err;
        }
    }

    private async runStep(
        ctx: TelegramContext<Update>,
        scene: SceneControl,
        instance: TelegramSceneInstance,
        active: ActiveInput,
        pressed: unknown,
    ): Promise<void> {
        this.track(active, ctx.update.message?.message_id);

        const transition = await this.trackingMessages(ctx, active, () =>
            active.step.handle(
                ctx,
                this.inputControl(instance, active, pressed),
            ),
        );

        await this.applyTransition(ctx, scene, instance, active, transition);
    }

    private async applyTransition(
        ctx: TelegramContext,
        scene: SceneControl,
        instance: TelegramSceneInstance,
        active: ActiveInput,
        transition: TelegramTransition<InputPayload>,
    ): Promise<void> {
        const { input, step, state } = active;

        if ("patch" in transition && transition.patch) {
            Object.assign(state.payload, transition.patch);
        }

        if (transition.type !== "cancel" && transition.type !== "complete") {
            this.recordEvent(instance, transition.type);
        }

        switch (transition.type) {
            case "stay":
                return;
            case "next": {
                const nextStep = input.steps[input.steps.indexOf(step) + 1];

                if (!nextStep) {
                    return this.complete(ctx, scene, instance, active);
                }

                state.history.push(step.name);
                return this.leaveStep(ctx, scene, instance, active, nextStep);
            }
            case "goto":
                state.history.push(step.name);
                return this.leaveStep(
                    ctx,
                    scene,
                    instance,
                    active,
                    findStep(input, transition.step),
                );
            case "back": {
                const previousStepName = state.history.pop();

                if (!previousStepName) {
                    throw new Error(
                        `Telegram scene input "${state.name}" has no previous step`,
                    );
                }

                return this.leaveStep(
                    ctx,
                    scene,
                    instance,
                    active,
                    findStep(input, previousStepName),
                );
            }
            case "cancel":
                await this.cancel(ctx, scene, instance, {
                    silent: transition.silent,
                });
                return;
            case "complete":
                return this.complete(ctx, scene, instance, active);
        }
    }

    private async leaveStep(
        ctx: TelegramContext,
        scene: SceneControl,
        instance: TelegramSceneInstance,
        active: ActiveInput,
        targetStep: TelegramStep<InputPayload>,
    ): Promise<void> {
        await this.cleanUp(ctx, active);
        await this.enterStep(ctx, scene, instance, {
            ...active,
            step: targetStep,
        });
    }

    private async enterStep(
        ctx: TelegramContext,
        scene: SceneControl,
        instance: TelegramSceneInstance,
        active: ActiveInput,
    ): Promise<void> {
        active.state.step = active.step.name;
        this.buttons.forgetInputButtons(instance);

        ctx.log.info(
            {
                scene: instance.scene.name,
                sceneId: instance.id,
                input: active.state.name,
                step: active.step.name,
            },
            "Telegram scene step entered",
        );

        const transition = await this.trackingMessages(ctx, active, () =>
            active.step.enter(
                ctx,
                this.inputControl(instance, active, undefined),
            ),
        );

        if (transition) {
            await this.applyTransition(
                ctx,
                scene,
                instance,
                active,
                transition,
            );
        }
    }

    private async complete(
        ctx: TelegramContext,
        scene: SceneControl,
        instance: TelegramSceneInstance,
        active: ActiveInput,
    ): Promise<void> {
        const payload: InputPayload = Value.Decode(
            active.input.payload,
            active.state.payload,
        );

        await this.finish(ctx, instance, active);
        this.recordEvent(instance, "complete");
        ctx.log.info(
            {
                scene: instance.scene.name,
                sceneId: instance.id,
                input: active.state.name,
            },
            "Telegram scene input completed",
        );

        await active.input.complete(ctx, scene, payload);
    }

    private async finish(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        active: ActiveInput,
    ): Promise<void> {
        instance.record.input = undefined;
        this.buttons.forgetInputButtons(instance);
        await this.cleanUp(ctx, active);
    }

    private async cleanUp(
        ctx: TelegramContext,
        active: ActiveInput,
    ): Promise<void> {
        const messageIds = active.state.messageIds.splice(0);

        if (active.input.cleanup && messageIds.length) {
            await ctx.deleteMessages(messageIds);
        }
    }

    private track(active: ActiveInput, messageId: number | undefined): void {
        if (active.input.cleanup && messageId !== undefined) {
            active.state.messageIds.push(messageId);
        }
    }

    private async trackingMessages<T>(
        ctx: TelegramContext,
        active: ActiveInput,
        action: () => Promise<T>,
    ): Promise<T> {
        const stopTracking = ctx.events.on("messageSent", ({ data }) => {
            this.track(active, data.messageId);
        });

        try {
            return await action();
        } finally {
            stopTracking();
        }
    }

    private inputControl(
        instance: TelegramSceneInstance,
        active: ActiveInput,
        pressed: unknown,
    ): TelegramInputControl<InputPayload> {
        return {
            name: active.state.name,
            step: active.step.name,
            payload: active.state.payload,
            pressed,
            button: (text, value) =>
                this.buttons.create(instance, text, {
                    kind: "input",
                    step: active.step.name,
                    value,
                }),
        };
    }

    private findActive(
        instance: TelegramSceneInstance,
    ): ActiveInput | undefined {
        const state = instance.record.input;
        const input = state && instance.scene.inputs[state.name];
        const step = input?.steps.find(({ name }) => name === state?.step);

        if (state && input && step) {
            return { input, step, state };
        }
    }

    private requireActive(instance: TelegramSceneInstance): ActiveInput {
        const active = this.findActive(instance);

        if (!active) {
            throw new Error(
                `Telegram scene "${instance.scene.name}" has no active input`,
            );
        }

        return active;
    }

    private recordEvent(
        instance: TelegramSceneInstance,
        event: Parameters<TelegramMetrics["recordSceneEvent"]>[1],
    ): void {
        this.telegramMetrics.recordSceneEvent(instance.scene.name, event);
    }
}

function findStep(
    input: TelegramSceneInput,
    stepName: string,
): TelegramStep<InputPayload> {
    const targetStep = input.steps.find(({ name }) => name === stepName);

    if (!targetStep) {
        throw new Error(`Telegram scene input has no step "${stepName}"`);
    }

    return targetStep;
}
