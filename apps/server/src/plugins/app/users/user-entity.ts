import { BaseEntity } from "../../../types/entities/base-entity.js";
import { Language } from "../i18n-service.js";

export interface UserEntity extends BaseEntity {
    telegramId: string;
    isBanned: boolean;
    languageCode: Language;
    timeZone?: string;
}
