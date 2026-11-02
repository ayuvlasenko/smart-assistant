import { ObjectId } from "mongodb";
import { UserEntity } from "../plugins/app/users/user-entity.js";
import { testTelegramBotId } from "./telegram-fixtures.js";

export function buildUserEntity(
    overrides: Partial<UserEntity> = {},
): UserEntity {
    return {
        _id: new ObjectId(),
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        botId: testTelegramBotId,
        telegramId: "1",
        isBanned: false,
        grants: [],
        languageCode: "en",
        ...overrides,
    };
}
