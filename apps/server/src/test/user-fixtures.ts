import { ObjectId } from "mongodb";
import { UserEntity } from "../plugins/app/users/user-entity.js";
import { testBotId } from "./telegram-fixtures.js";

export function buildUserEntity(
    overrides: Partial<UserEntity> = {},
): UserEntity {
    return {
        _id: new ObjectId(),
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        botId: testBotId,
        telegramId: "1",
        isBanned: false,
        grants: [],
        languageCode: "en",
        ...overrides,
    };
}
