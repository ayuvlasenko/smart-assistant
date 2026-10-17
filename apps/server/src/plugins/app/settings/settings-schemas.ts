import { type Static, Type } from "@sinclair/typebox";
import { TelegramContext } from "../telegram/telegram-context.js";
import { TelegramSceneControl } from "../telegram/telegram-scene.js";
import { SettingsService } from "./settings-service.js";

export const settingsStateSchema = Type.Object({
    screen: Type.Union([Type.Literal("list"), Type.Literal("choices")]),
    setting: Type.Union([Type.String(), Type.Null()]),
});

export const settingsButtonValues = {
    open: Type.String(),
    choose: Type.String(),
    back: Type.Null(),
};

export type SettingsState = Static<typeof settingsStateSchema>;

export type SettingsSceneControl = TelegramSceneControl<
    SettingsState,
    typeof settingsButtonValues
>;

export interface SettingsView {
    ctx: TelegramContext;
    scene: SettingsSceneControl;
    settingsService: SettingsService;
}
