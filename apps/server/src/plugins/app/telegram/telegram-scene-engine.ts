import { Update } from "@grammyjs/types";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { TelegramContext } from "./telegram-context.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { TelegramSceneInputs } from "./telegram-scene-inputs.js";
import { TelegramScenePresses } from "./telegram-scene-presses.js";
import { TelegramSceneRun } from "./telegram-scene-run.js";
import { TelegramScene, TelegramSceneControl } from "./telegram-scene.js";
import { TelegramSession } from "./telegram-session.js";

type SceneState = Record<string, unknown>;
type SceneControl = TelegramSceneControl<SceneState>;

export class TelegramSceneEngine {
    private readonly scenes = new Map<string, TelegramScene>();
    private readonly runs = new WeakMap<TelegramSession, TelegramSceneRun>();
    private readonly inputs: TelegramSceneInputs;
    private readonly presses: TelegramScenePresses;
    private readonly telegramMetrics: TelegramMetrics;

    constructor(telegramMetrics: TelegramMetrics) {
        this.telegramMetrics = telegramMetrics;
        this.inputs = new TelegramSceneInputs(telegramMetrics);
        this.presses = new TelegramScenePresses(telegramMetrics, this.inputs);
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

    start(
        ctx: TelegramContext,
        scene: TelegramScene,
        state: SceneState,
    ): Promise<boolean> {
        return this.runOf(ctx).start(scene, state);
    }

    cancel(ctx: TelegramContext): Promise<boolean> {
        return this.runOf(ctx).cancel();
    }

    handle(
        ctx: TelegramContext<Update>,
        next: () => Promise<void>,
    ): Promise<void> {
        return this.runOf(ctx).handle(ctx, next);
    }

    deliver(
        ctx: TelegramContext,
        scene: TelegramScene,
        key: string,
        handle: (scene: SceneControl) => Promise<unknown>,
    ): Promise<boolean> {
        return this.runOf(ctx).deliver(scene, key, handle);
    }

    redraw(
        ctx: TelegramContext,
        sceneId: string,
        topics: readonly string[],
    ): Promise<boolean> {
        return this.runOf(ctx).redraw(sceneId, topics);
    }

    async withScenes<T>(
        ctx: TelegramContext,
        action: () => Promise<T>,
    ): Promise<T> {
        const run = new TelegramSceneRun(
            ctx,
            (name) => this.scenes.get(name),
            this.telegramMetrics,
            this.inputs,
            this.presses,
        );
        const stopRecording = ctx.events.on(
            ["messageSent", "messageEdited", "messageRemoved"],
            ({ data }) => {
                run.rememberButtons(data);
            },
        );

        this.runs.set(ctx.session, run);

        try {
            const result = await action();

            await run.render();

            return result;
        } finally {
            stopRecording();
            run.save();
            this.runs.delete(ctx.session);
        }
    }

    private runOf(ctx: TelegramContext): TelegramSceneRun {
        const run = this.runs.get(ctx.session);

        if (!run) {
            throw new Error("Telegram scenes are used outside withScenes");
        }

        return run;
    }
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
