import { Update } from "@grammyjs/types";
import { Value } from "@sinclair/typebox/value";
import { TelegramContext } from "./telegram-context.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import {
    TelegramButtonPress,
    TelegramSceneButtons,
} from "./telegram-scene-buttons.js";
import { TelegramSceneInputs } from "./telegram-scene-inputs.js";
import {
    TelegramSceneScreens,
    TelegramScreenState,
} from "./telegram-scene-screens.js";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";
import { TelegramSceneControl } from "./telegram-scene.js";

export type TelegramSceneControlFactory = (
    ctx: TelegramContext,
    instance: TelegramSceneInstance,
) => TelegramSceneControl<Record<string, unknown>>;

export class TelegramScenePresses {
    private readonly telegramMetrics: TelegramMetrics;
    private readonly buttons: TelegramSceneButtons;
    private readonly inputs: TelegramSceneInputs;
    private readonly screens: TelegramSceneScreens;
    private readonly controlOf: TelegramSceneControlFactory;

    constructor(
        telegramMetrics: TelegramMetrics,
        buttons: TelegramSceneButtons,
        inputs: TelegramSceneInputs,
        screens: TelegramSceneScreens,
        controlOf: TelegramSceneControlFactory,
    ) {
        this.telegramMetrics = telegramMetrics;
        this.buttons = buttons;
        this.inputs = inputs;
        this.screens = screens;
        this.controlOf = controlOf;
    }

    async handle(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance | undefined,
        press: TelegramButtonPress,
    ): Promise<void> {
        const button = instance && this.buttons.find(instance, press);

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
                );
            case "screen":
                return this.pressScreen(ctx, instance, button.screen);
            case "back":
                return this.pressBack(ctx, instance);
            case "scene":
                return this.pressScene(
                    ctx,
                    instance,
                    button.name,
                    button.value,
                );
        }
    }

    private async pressInput(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
        step: string,
        value: unknown,
    ): Promise<void> {
        const action = `${instance.scene.name}:input`;

        if (!this.inputs.canUse(instance, ctx.user)) {
            return this.rejectForbidden(ctx, action);
        }

        instance.record.confirming = undefined;

        const isHandled = await this.inputs.handleButton(
            ctx,
            this.controlOf(ctx, instance),
            instance,
            step,
            value,
        );

        if (!isHandled) {
            return this.rejectExpired(ctx, action);
        }

        this.record(instance, "input");
    }

    private async pressScreen(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
        screen: TelegramScreenState,
    ): Promise<void> {
        const action = `${instance.scene.name}:screen:${screen.name}`;

        if (!this.screens.isKnown(instance.scene, screen)) {
            return this.rejectExpired(ctx, action);
        }

        if (
            !isAllowed(instance.scene.guard, ctx.user) ||
            !this.screens.canShow(instance, ctx.user, screen)
        ) {
            return this.rejectForbidden(ctx, action);
        }

        await this.controlOf(ctx, instance).push(screen.name, screen.params);
        this.record(instance, `screen:${screen.name}`);
    }

    private async pressBack(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
    ): Promise<void> {
        if (!isAllowed(instance.scene.guard, ctx.user)) {
            return this.rejectForbidden(ctx, `${instance.scene.name}:back`);
        }

        await this.controlOf(ctx, instance).back();
        this.record(instance, "back");
    }

    private async pressScene(
        ctx: TelegramContext<Update>,
        instance: TelegramSceneInstance,
        name: string,
        value: unknown,
    ): Promise<void> {
        const definition = instance.scene.buttons[name];
        const action = `${instance.scene.name}:${name}`;

        if (!definition || !Value.Check(definition.value, value)) {
            return this.rejectExpired(ctx, action);
        }

        if (
            !isAllowed(instance.scene.guard, ctx.user) ||
            !isAllowed(definition.guard, ctx.user)
        ) {
            return this.rejectForbidden(ctx, action);
        }

        const control = this.controlOf(ctx, instance);

        if (!definition.confirm) {
            instance.record.confirming = undefined;
        } else if (!this.buttons.confirm(instance, name, value)) {
            this.record(instance, name);
            return;
        }

        await definition.handle(ctx, control, value);
        this.record(instance, name);
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

    private record(instance: TelegramSceneInstance, button: string): void {
        this.telegramMetrics.recordButtonPress(
            `${instance.scene.name}:${button}`,
            "handled",
        );
    }
}
