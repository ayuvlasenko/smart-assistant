import { ObjectId } from "mongodb";

export interface SettingEntity {
    _id: ObjectId;
    botId: string;
    name: string;
    value: unknown;
    version: number;
    updatedBy: ObjectId;
    updatedAt: Date;
}

export interface SettingsSubjects {
    Setting: SettingEntity;
}
