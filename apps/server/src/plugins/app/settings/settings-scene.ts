import { Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { numberStep } from "../telegram/telegram-steps.js";
import { SettingsSubjects } from "./setting-entity.js";
import {
    settingsButtonValues,
    SettingsState,
    settingsStateSchema,
    SettingsView,
} from "./settings-schemas.js";
import {
    renderSettingsChoices,
    renderSettingsList,
} from "./settings-screen.js";
import { ChoicesSetting, SettingsService } from "./settings-service.js";

export const settingsTopic = "settings";

const settingsSceneTtlMilliseconds = 24 * 60 * 60 * 1000;

export function buildSettingsState(): SettingsState {
    return { screen: "list", setting: null };
}

export function createSettingsScene(
    settingsService: SettingsService,
    access: AccessControl<SettingsSubjects>,
): TelegramScene<typeof settingsStateSchema> {
    const canUpdate = access.guard("update", "Setting");

    return defineScene({
        name: "settings",
        state: settingsStateSchema,
        ttl: settingsSceneTtlMilliseconds,
        guard: canUpdate,
        key: () => "settings",
        watch: () => [settingsTopic],
        slots: {
            settings: async (ctx, scene) =>
                render({ ctx, scene, settingsService }),
        },
        buttons: {
            open: {
                value: settingsButtonValues.open,
                handle: async (ctx, scene, name) => {
                    const setting = settingsService.find(name);

                    switch (setting?.kind) {
                        case "flag":
                            await settingsService.toggle(ctx.user, setting);
                            return;
                        case "number":
                            scene.state.setting = setting.name;
                            await scene.ask("number");
                            return;
                        case "choices":
                            scene.state.screen = "choices";
                            scene.state.setting = setting.name;
                    }
                },
            },
            choose: {
                value: settingsButtonValues.choose,
                handle: async (ctx, scene, option) => {
                    const setting = findChoices(
                        settingsService,
                        scene.state.setting,
                    );

                    if (!setting) {
                        return;
                    }

                    await settingsService.toggleChoice(
                        ctx.user,
                        setting,
                        option,
                    );
                },
            },
            back: {
                value: settingsButtonValues.back,
                handle: async (ctx, scene) => {
                    scene.state.screen = "list";
                    scene.state.setting = null;
                },
            },
        },
        inputs: {
            number: {
                payload: Type.Object({ value: Type.Integer() }),
                guard: canUpdate,
                cleanup: true,
                steps: (step) => [
                    numberStep(step, {
                        name: "value",
                        property: "value",
                        prompt: (t) => t("settings:numberPrompt"),
                        maxFractionDigits: 0,
                    }),
                ],
                complete: async (ctx, scene, { value }) => {
                    const setting = settingsService.find(
                        scene.state.setting ?? "",
                    );

                    if (setting?.kind !== "number") {
                        return;
                    }

                    if (value < setting.min || value > setting.max) {
                        await ctx.reply(
                            ctx.t("telegram:numberOutOfRange", {
                                min: setting.min,
                                max: setting.max,
                            }),
                        );
                        await scene.ask("number");
                        return;
                    }

                    await settingsService.write(ctx.user, setting, value);
                },
            },
        },
    });
}

function render(view: SettingsView): TelegramMessageContent {
    const setting =
        view.scene.state.screen === "choices"
            ? findChoices(view.settingsService, view.scene.state.setting)
            : undefined;

    return setting
        ? renderSettingsChoices(view, setting)
        : renderSettingsList(view);
}

function findChoices(
    settingsService: SettingsService,
    name: string | null,
): ChoicesSetting | undefined {
    const setting = name === null ? undefined : settingsService.find(name);

    return setting?.kind === "choices" ? setting : undefined;
}
