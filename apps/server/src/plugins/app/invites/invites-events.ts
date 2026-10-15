import { ObjectId } from "mongodb";

export interface InvitesEvents {
    "invites.inviteChanged": {
        inviteId: ObjectId;
    };
}
