import { Update } from "@grammyjs/types";
import { Value } from "@sinclair/typebox/value";
import { TelegramContext } from "./telegram-context.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import {
    cancelConfirmation,
    confirmSceneButton,
    findPressedButton,
    TelegramButtonPress,
    TelegramSceneButton,
} from "./telegram-scene-buttons.js";
import { TelegramSceneInputs } from "./telegram-scene-inputs.js";
import {
    canShowScreen,
    isKnownScreen,
    TelegramScreenState,
} from "./telegram-scene-screens.js";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";
import { TelegramSceneControl } from "./telegram-scene.js";

type TelegramSceneControlOf = (
    instance: TelegramSceneInstance,
) => TelegramSceneControl<Record<string, unknown>>;

export class TelegramScenePresses {
    private readonly telegramMetrics: TelegramMetrics;
    private readonly inputs: TelegramSceneInputs;

    constructor(telegramMetrics: TelegramMetrics, inputs: TelegramSceneInputs) {
        this.telegramMetrics = telegramMetrics;
        this.inputs = inputs;
    }

    async press(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance | undefined,
        press: TelegramButtonPress,
        control: TelegramSceneControlOf,
    ): Promise<void> {
        const button = instance && findPressedButton(instance, press);

        if (!instance || !button) {
            return this.rejectExpired(ctx, "unknown");
        }

        switch (button.kind) {
            case "input":
                return this.pressInput(
                    ctx,
                    instance,
                    button.step,
                    button.value,
                    control,
                );
            case "screen":
                return this.pressScreen(ctx, instance, button.screen, control);
            case "back":
                return this.pressBack(ctx, instance, control);
            case "scene":
                return this.pressScene(ctx, instance, button, control);
        }
    }

    private async pressInput(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
        step: string,
        value: unknown,
        control: TelegramSceneControlOf,
    ): Promise<void> {
        const action = `${instance.scene.name}:input`;

        if (!(await this.inputs.canUse(instance, ctx.user))) {
            return this.rejectForbidden(ctx, action);
        }

        const scene = control(instance);

        cancelConfirmation(instance);

        const isHandled = await this.inputs.handleButton(
            ctx,
            scene,
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
        instance: TelegramSceneInstance,
        screen: TelegramScreenState,
        control: TelegramSceneControlOf,
    ): Promise<void> {
        const action = `${instance.scene.name}:screen:${screen.name}`;

        if (!isKnownScreen(instance.scene, screen)) {
            return this.rejectExpired(ctx, action);
        }

        if (
            !(await isAllowed(instance.scene.guard, ctx.user)) ||
            !(await canShowScreen(instance, ctx.user, screen))
        ) {
            return this.rejectForbidden(ctx, action);
        }

        await control(instance).push(screen.name, screen.params);
        this.record(ctx, instance, `screen:${screen.name}`);
    }

    private async pressBack(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
        control: TelegramSceneControlOf,
    ): Promise<void> {
        if (!(await isAllowed(instance.scene.guard, ctx.user))) {
            return this.rejectForbidden(ctx, `${instance.scene.name}:back`);
        }

        await control(instance).back();
        this.record(ctx, instance, "back");
    }

    private async pressScene(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
        button: TelegramSceneButton,
        control: TelegramSceneControlOf,
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

        const scene = control(instance);

        if (!definition.confirm) {
            cancelConfirmation(instance);
        } else if (!confirmSceneButton(instance, button)) {
            this.record(ctx, instance, name);
            return;
        }

        await definition.handle(ctx, scene, value);
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
