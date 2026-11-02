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
        botId: string;
        roomId: ObjectId;
        userIds: ObjectId[];
        change: PokerRoomChange;
    };
}
