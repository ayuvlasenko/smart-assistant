import { ObjectId } from "mongodb";
import { BaseEntity } from "../../../entity.js";
import { defaultLanguage, Language } from "../i18n-service.js";

export type UserSettings = Record<string, Record<string, unknown>>;

export interface UserEntity extends BaseEntity {
    botId: string;
    telegramId: string;
    isBanned: boolean;
    grants: string[];
    languageCode: Language;
    firstName?: string;
    username?: string;
    timeZone?: string;
    commandMenu?: string;
    settings?: UserSettings;
}

export type UserProfile = Pick<
    UserEntity,
    "languageCode" | "firstName" | "username"
>;

export function readUserSetting(
    user: Pick<UserEntity, "settings">,
    name: string,
): unknown {
    const [domain = "", key = ""] = name.split(".");

    return user.settings?.[domain]?.[key];
}

export function buildUserWithoutGrants(botId: string): UserEntity {
    const now = new Date();

    return {
        _id: new ObjectId(),
        version: 0,
        createdAt: now,
        updatedAt: now,
        botId,
        telegramId: "0",
        isBanned: false,
        grants: [],
        languageCode: defaultLanguage,
    };
}
