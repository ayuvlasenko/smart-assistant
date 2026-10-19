import { Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { numberStep } from "../telegram/telegram-steps.js";
import { SettingsSubjects } from "./setting-entity.js";
import {
    settingsButtonValues,
    settingsScreens,
    SettingsState,
    settingsStateSchema,
} from "./settings-schemas.js";
import {
    renderSettingsChoices,
    renderSettingsList,
} from "./settings-screen.js";
import { ChoicesSetting, SettingsService } from "./settings-service.js";

export const settingsTopic = "settings";

const settingsSceneTtlMilliseconds = 24 * 60 * 60 * 1000;

export function buildSettingsState(): SettingsState {
    return { numberSetting: null };
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
        root: { name: "list", params: {} },
        screens: {
            list: {
                params: settingsScreens.list,
                render: async (ctx, scene) => [
                    renderSettingsList({ ctx, scene, settingsService }),
                ],
            },
            choices: {
                params: settingsScreens.choices,
                render: async (ctx, scene, { setting }) => {
                    const view = { ctx, scene, settingsService };
                    const choices = findChoices(settingsService, setting);

                    return [
                        choices
                            ? renderSettingsChoices(view, choices)
                            : renderSettingsList(view),
                    ];
                },
            },
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
                            scene.state.numberSetting = setting.name;
                            await scene.ask("number");
                            return;
                        case "choices":
                            await scene.push("choices", {
                                setting: setting.name,
                            });
                    }
                },
            },
            choose: {
                value: settingsButtonValues.choose,
                handle: async (ctx, scene, option) => {
                    const setting =
                        scene.screen.name === "choices"
                            ? findChoices(
                                  settingsService,
                                  scene.screen.params.setting,
                              )
                            : undefined;

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
                        scene.state.numberSetting ?? "",
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

function findChoices(
    settingsService: SettingsService,
    name: string,
): ChoicesSetting | undefined {
    const setting = settingsService.find(name);

    return setting?.kind === "choices" ? setting : undefined;
}
