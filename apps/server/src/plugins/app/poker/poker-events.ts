import { ObjectId } from "mongodb";

export interface PokerEvents {
    "poker.roomChanged": {
        roomId: ObjectId;
        userIds: ObjectId[];
    };
}
