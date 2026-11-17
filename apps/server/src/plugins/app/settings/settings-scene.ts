import { Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { numberStep } from "../telegram/telegram-steps.js";
import { SettingsSubjects } from "./setting-entity.js";
import {
    settingsButtonValues,
    SettingsSceneControl,
    settingsScreens,
    SettingsState,
    settingsStateSchema,
    SettingsView,
} from "./settings-schemas.js";
import {
    renderBotSettings,
    renderOwnSettingChoice,
    renderOwnSettings,
    renderSettingsChoices,
} from "./settings-screen.js";
import { ChoicesSetting, SettingsService } from "./settings-service.js";
import { UserSettingsService } from "./user-settings-service.js";

export const settingsTopic = "settings";

const settingsSceneTtlMilliseconds = 24 * 60 * 60 * 1000;

export function buildSettingsState(): SettingsState {
    return { numberSetting: null };
}

export function createSettingsScene(
    settingsService: SettingsService,
    userSettingsService: UserSettingsService,
    access: AccessControl<SettingsSubjects>,
): TelegramScene<typeof settingsStateSchema> {
    const canUpdate = access.guard("update", "Setting");
    const viewOf = (
        ctx: TelegramContext,
        scene: SettingsSceneControl,
    ): SettingsView => ({
        ctx,
        scene,
        settingsService,
        userSettingsService,
        canChangeBot: canUpdate(ctx.user),
    });

    return defineScene({
        name: "settings",
        state: settingsStateSchema,
        ttl: settingsSceneTtlMilliseconds,
        key: () => "settings",
        root: { name: "list", params: {} },
        screens: {
            list: {
                params: settingsScreens.list,
                render: async (ctx, scene) => [
                    renderOwnSettings(viewOf(ctx, scene)),
                ],
            },
            choice: {
                params: settingsScreens.choice,
                render: async (ctx, scene, { setting }) => {
                    const view = viewOf(ctx, scene);
                    const own = userSettingsService.find(setting);

                    return [
                        own
                            ? renderOwnSettingChoice(view, own)
                            : renderOwnSettings(view),
                    ];
                },
            },
            bot: {
                params: settingsScreens.bot,
                guard: canUpdate,
                watch: () => [settingsTopic],
                render: async (ctx, scene) => [
                    renderBotSettings(viewOf(ctx, scene)),
                ],
            },
            choices: {
                params: settingsScreens.choices,
                guard: canUpdate,
                watch: () => [settingsTopic],
                render: async (ctx, scene, { setting }) => {
                    const view = viewOf(ctx, scene);
                    const choices = findChoices(settingsService, setting);

                    return [
                        choices
                            ? renderSettingsChoices(view, choices)
                            : renderBotSettings(view),
                    ];
                },
            },
        },
        buttons: {
            openOwn: {
                value: settingsButtonValues.openOwn,
                handle: async (ctx, scene, name) => {
                    if (userSettingsService.find(name)) {
                        await scene.push("choice", { setting: name });
                    }
                },
            },
            pick: {
                value: settingsButtonValues.pick,
                handle: async (ctx, scene, option) => {
                    const setting =
                        scene.screen.name === "choice"
                            ? userSettingsService.find(
                                  scene.screen.params.setting,
                              )
                            : undefined;

                    if (setting) {
                        ctx.refreshUser(
                            await userSettingsService.write(
                                ctx.user,
                                setting,
                                option,
                            ),
                        );
                    }
                },
            },
            open: {
                value: settingsButtonValues.open,
                guard: canUpdate,
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
                guard: canUpdate,
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
