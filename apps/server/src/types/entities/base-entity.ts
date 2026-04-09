import { ObjectId } from "mongodb";

export interface BaseEntity {
    _id: ObjectId;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}
