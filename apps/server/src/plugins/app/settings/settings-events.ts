import { UserEntity } from "../users/user-entity.js";

export interface SettingsEvents {
    "settings.settingChanged": {
        botId: string;
        name: string;
    };
    "settings.userSettingChanged": {
        user: UserEntity;
        name: string;
    };
}
