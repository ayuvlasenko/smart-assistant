import { Update } from "@grammyjs/types";
import { Value } from "@sinclair/typebox/value";
import { TelegramContext } from "./telegram-context.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import {
    TelegramButtonPress,
    TelegramSceneButton,
    TelegramSceneButtons,
} from "./telegram-scene-buttons.js";
import { TelegramSceneInputs } from "./telegram-scene-inputs.js";
import { type TelegramSceneRun } from "./telegram-scene-run.js";
import {
    TelegramSceneScreens,
    TelegramScreenState,
} from "./telegram-scene-screens.js";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";

export class TelegramScenePresses {
    private readonly telegramMetrics: TelegramMetrics;
    private readonly buttons: TelegramSceneButtons;
    private readonly inputs: TelegramSceneInputs;
    private readonly screens: TelegramSceneScreens;

    constructor(
        telegramMetrics: TelegramMetrics,
        buttons: TelegramSceneButtons,
        inputs: TelegramSceneInputs,
        screens: TelegramSceneScreens,
    ) {
        this.telegramMetrics = telegramMetrics;
        this.buttons = buttons;
        this.inputs = inputs;
        this.screens = screens;
    }

    async handle(
        ctx: TelegramContext<Update>,
        run: TelegramSceneRun,
        press: TelegramButtonPress,
    ): Promise<void> {
        const instance = await run.storage.load(press.sceneId);
        const button = instance && this.buttons.find(instance, press);

        if (!instance || !button) {
            return this.rejectExpired(ctx, "unknown");
        }

        switch (button.kind) {
            case "input":
                return this.pressInput(
                    ctx,
                    run,
                    instance,
                    button.step,
                    button.value,
                );
            case "screen":
                return this.pressScreen(ctx, run, instance, button.screen);
            case "back":
                return this.pressBack(ctx, run, instance);
            case "scene":
                return this.pressScene(ctx, run, instance, button);
        }
    }

    private async pressInput(
        ctx: TelegramContext<Update>,
        run: TelegramSceneRun,
        instance: TelegramSceneInstance,
        step: string,
        value: unknown,
    ): Promise<void> {
        const action = `${instance.scene.name}:input`;

        if (!(await this.inputs.canUse(instance, ctx.user))) {
            return this.rejectForbidden(ctx, action);
        }

        run.touch(instance);
        this.buttons.cancelConfirmation(instance);

        const isHandled = await this.inputs.handleButton(
            ctx,
            run.control(instance),
            instance,
            step,
            value,
        );

        if (!isHandled) {
            return this.rejectExpired(ctx, action);
        }

        this.record(ctx, instance, "input");
    }

    private async pressScreen(
        ctx: TelegramContext<Update>,
        run: TelegramSceneRun,
        instance: TelegramSceneInstance,
        screen: TelegramScreenState,
    ): Promise<void> {
        const action = `${instance.scene.name}:screen:${screen.name}`;

        if (!this.screens.isKnown(instance.scene, screen)) {
            return this.rejectExpired(ctx, action);
        }

        if (
            !(await isAllowed(instance.scene.guard, ctx.user)) ||
            !(await this.screens.canShow(instance, ctx.user, screen))
        ) {
            return this.rejectForbidden(ctx, action);
        }

        run.touch(instance);
        await run.control(instance).push(screen.name, screen.params);
        this.record(ctx, instance, `screen:${screen.name}`);
    }

    private async pressBack(
        ctx: TelegramContext<Update>,
        run: TelegramSceneRun,
        instance: TelegramSceneInstance,
    ): Promise<void> {
        if (!(await isAllowed(instance.scene.guard, ctx.user))) {
            return this.rejectForbidden(ctx, `${instance.scene.name}:back`);
        }

        run.touch(instance);
        await run.control(instance).back();
        this.record(ctx, instance, "back");
    }

    private async pressScene(
        ctx: TelegramContext<Update>,
        run: TelegramSceneRun,
        instance: TelegramSceneInstance,
        button: TelegramSceneButton,
    ): Promise<void> {
        const { name, value } = button;
        const definition = instance.scene.buttons[name];
        const action = `${instance.scene.name}:${name}`;

        if (!definition || !Value.Check(definition.value, value)) {
            return this.rejectExpired(ctx, action);
        }

        if (
            !(await isAllowed(instance.scene.guard, ctx.user)) ||
            !(await isAllowed(definition.guard, ctx.user))
        ) {
            return this.rejectForbidden(ctx, action);
        }

        run.touch(instance);

        if (!definition.confirm) {
            this.buttons.cancelConfirmation(instance);
        } else if (!this.buttons.confirm(instance, button)) {
            this.record(ctx, instance, name);
            return;
        }

        await definition.handle(ctx, run.control(instance), value);
        this.record(ctx, instance, name);
    }

    private async rejectExpired(
        ctx: TelegramContext<Update>,
        action: string,
    ): Promise<void> {
        this.telegramMetrics.recordButtonPress(action, "expired");
        ctx.log.info({ action }, "Telegram button is expired");

        await ctx.answerCallbackQuery(ctx.t("telegram:buttonExpired"));
    }

    private async rejectForbidden(
        ctx: TelegramContext<Update>,
        action: string,
    ): Promise<void> {
        this.telegramMetrics.recordButtonPress(action, "forbidden");
        ctx.log.info({ action }, "Telegram button is forbidden");

        await ctx.answerCallbackQuery();
    }

    private record(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
        button: string,
    ): void {
        this.telegramMetrics.recordButtonPress(
            `${instance.scene.name}:${button}`,
            "handled",
        );
        ctx.log.info(
            { scene: instance.scene.name, sceneId: instance.id, button },
            "Telegram scene button pressed",
        );
    }
}
