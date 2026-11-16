import { ObjectId } from "mongodb";

export interface InvitesEvents {
    "invites.inviteChanged": {
        botId: string;
        inviteId: ObjectId;
    };
}
