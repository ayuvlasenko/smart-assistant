import { type Static, Type } from "@sinclair/typebox";
import { TelegramContext } from "../telegram/telegram-context.js";
import {
    TelegramSceneControl,
    TelegramSceneInputSchemas,
} from "../telegram/telegram-scene.js";
import { SettingsService } from "./settings-service.js";

export const settingsStateSchema = Type.Object({
    numberSetting: Type.Union([Type.String(), Type.Null()]),
});

export const settingsScreens = {
    list: Type.Object({}),
    choices: Type.Object({ setting: Type.String() }),
};

export const settingsButtonValues = {
    open: Type.String(),
    choose: Type.String(),
};

export type SettingsState = Static<typeof settingsStateSchema>;

export type SettingsSceneControl = TelegramSceneControl<
    SettingsState,
    typeof settingsButtonValues,
    TelegramSceneInputSchemas,
    typeof settingsScreens
>;

export interface SettingsView {
    ctx: TelegramContext;
    scene: SettingsSceneControl;
    settingsService: SettingsService;
}
