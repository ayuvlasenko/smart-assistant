import { ObjectId } from "mongodb";

export type PokerRoomChange =
    | "created"
    | "joined"
    | "voted"
    | "revealed"
    | "roundStarted"
    | "roundRenamed"
    | "closed";

export interface PokerEvents {
    "poker.roomChanged": {
        roomId: ObjectId;
        userIds: ObjectId[];
        change: PokerRoomChange;
    };
}
