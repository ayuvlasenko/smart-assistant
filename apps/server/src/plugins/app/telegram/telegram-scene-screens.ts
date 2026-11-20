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

export function isValidSceneScreen(
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
        [screen, ...stack].every((entry) => isKnownScreen(scene, entry))
    );
}

export function isKnownScreen(
    scene: TelegramScene,
    screen: TelegramScreenState,
): boolean {
    const definition = scene.screens[screen.name];

    return !!definition && Value.Check(definition.params, screen.params);
}

export function canShowScreen(
    instance: TelegramSceneInstance,
    user: UserEntity,
    screen: TelegramScreenState,
): Promise<boolean> {
    return isAllowed(instance.scene.screens[screen.name]?.guard, user);
}

export function openRootScreen(instance: TelegramSceneInstance): void {
    const { root } = instance.scene;

    if (root) {
        instance.record.screen = structuredClone(root);
        instance.record.stack = [];
    }
}

export async function renderCurrentScreen(
    ctx: TelegramContext,
    instance: TelegramSceneInstance,
    scene: TelegramSceneControl<Record<string, unknown>>,
): Promise<TelegramMessageContent[]> {
    if (!(await canShowScreen(instance, ctx.user, currentScreen(instance)))) {
        resetScreens(instance);
    }

    const screen = currentScreen(instance);
    const definition = instance.scene.screens[screen.name];

    if (!definition) {
        throw new Error(
            `Telegram scene "${instance.scene.name}" has no screen "${screen.name}"`,
        );
    }

    return definition.render(ctx, scene, screen.params);
}

export function pushScreen(
    instance: TelegramSceneInstance,
    screen: TelegramScreenState,
): void {
    instance.record.stack = [
        ...(instance.record.stack ?? []),
        currentScreen(instance),
    ];
    instance.record.screen = screen;
}

export function replaceScreen(
    instance: TelegramSceneInstance,
    screen: TelegramScreenState,
): void {
    currentScreen(instance);
    instance.record.screen = screen;
}

export function backScreen(instance: TelegramSceneInstance): void {
    const stack = instance.record.stack ?? [];
    const previous = stack.at(-1);

    if (!previous) {
        resetScreens(instance);
        return;
    }

    instance.record.screen = previous;
    instance.record.stack = stack.slice(0, -1);
}

export function resetScreens(instance: TelegramSceneInstance): void {
    currentScreen(instance);
    openRootScreen(instance);
}

export function currentScreen(
    instance: TelegramSceneInstance,
): TelegramScreenState {
    const { screen } = instance.record;

    if (!screen) {
        throw new Error(
            `Telegram scene "${instance.scene.name}" has no screens`,
        );
    }

    return screen;
}
