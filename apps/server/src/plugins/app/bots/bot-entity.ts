import { ObjectId } from "mongodb";
import { BaseEntity } from "../../../entity.js";

export interface EncryptedBotToken {
    iv: string;
    tag: string;
    data: string;
}

export interface BotEntity extends Omit<BaseEntity, "_id"> {
    _id: string;
    username?: string;
    token?: EncryptedBotToken;
    modules: string[];
    createdBy?: ObjectId;
    disabledAt?: Date;
}

export interface BotsSubjects {
    Bot: BotEntity;
}

export function botIdOfToken(token: string): string {
    return token.split(":", 1).join("");
}
