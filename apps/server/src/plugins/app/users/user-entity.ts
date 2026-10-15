import { BaseEntity } from "../../../entity.js";
import { Language } from "../i18n-service.js";

export interface UserEntity extends BaseEntity {
    telegramId: string;
    isBanned: boolean;
    grants: string[];
    languageCode: Language;
    firstName?: string;
    username?: string;
    timeZone?: string;
}

export type UserProfile = Pick<
    UserEntity,
    "languageCode" | "firstName" | "username"
>;
