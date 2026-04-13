import { BaseEntity } from "./base-entity.js";

export interface UserEntity extends BaseEntity {
    telegramId: string;
    isBanned: boolean;
}
