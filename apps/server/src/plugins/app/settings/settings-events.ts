export interface SettingsEvents {
    "settings.settingChanged": {
        botId: string;
        name: string;
    };
}
