import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { UserEntity } from "../users/user-entity.js";
import { TelegramContext } from "./telegram-context.js";
import { isAllowed } from "./telegram-guard.js";
import { TelegramMessageContent } from "./telegram-responder.js";
import { TelegramSceneInstance } from "./telegram-scene-storage.js";
import { TelegramScene, TelegramSceneControl } from "./telegram-scene.js";

export const telegramScreenSchema = Type.Object({
    name: Type.String(),
    params: Type.Record(Type.String(), Type.Unknown()),
});

export type TelegramScreenState = Static<typeof telegramScreenSchema>;

export class TelegramSceneScreens {
    isValid(
        scene: TelegramScene,
        screen: TelegramScreenState | undefined,
        stack: TelegramScreenState[] | undefined,
    ): boolean {
        if (!scene.root) {
            return screen === undefined;
        }

        return (
            !!screen &&
            !!stack &&
            [screen, ...stack].every((entry) => this.isKnown(scene, entry))
        );
    }

    isKnown(scene: TelegramScene, screen: TelegramScreenState): boolean {
        const definition = scene.screens[screen.name];

        return !!definition && Value.Check(definition.params, screen.params);
    }

    canShow(
        instance: TelegramSceneInstance,
        user: UserEntity,
        screen: TelegramScreenState,
    ): boolean {
        return isAllowed(instance.scene.screens[screen.name]?.guard, user);
    }

    start(instance: TelegramSceneInstance): void {
        const { root } = instance.scene;

        if (root) {
            instance.record.screen = structuredClone(root);
            instance.record.stack = [];
        }
    }

    async render(
        ctx: TelegramContext,
        instance: TelegramSceneInstance,
        scene: TelegramSceneControl<Record<string, unknown>>,
    ): Promise<TelegramMessageContent[]> {
        if (!this.canShow(instance, ctx.user, this.of(instance))) {
            this.reset(instance);
        }

        const screen = this.of(instance);
        const definition = instance.scene.screens[screen.name];

        if (!definition) {
            throw new Error(
                `Telegram scene "${instance.scene.name}" has no screen "${screen.name}"`,
            );
        }

        return definition.render(ctx, scene, screen.params);
    }

    push(instance: TelegramSceneInstance, screen: TelegramScreenState): void {
        instance.record.stack = [
            ...(instance.record.stack ?? []),
            this.of(instance),
        ];
        instance.record.screen = screen;
    }

    replace(
        instance: TelegramSceneInstance,
        screen: TelegramScreenState,
    ): void {
        this.of(instance);
        instance.record.screen = screen;
    }

    back(instance: TelegramSceneInstance): void {
        const stack = instance.record.stack ?? [];
        const previous = stack.at(-1);

        if (!previous) {
            this.reset(instance);
            return;
        }

        instance.record.screen = previous;
        instance.record.stack = stack.slice(0, -1);
    }

    reset(instance: TelegramSceneInstance): void {
        this.of(instance);
        this.start(instance);
    }

    of(instance: TelegramSceneInstance): TelegramScreenState {
        const { screen } = instance.record;

        if (!screen) {
            throw new Error(
                `Telegram scene "${instance.scene.name}" has no screens`,
            );
        }

        return screen;
    }
}
