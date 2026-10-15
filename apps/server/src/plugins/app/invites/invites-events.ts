import { ObjectId } from "mongodb";

export interface InvitesEvents {
    "invites.inviteActivated": {
        inviteId: ObjectId;
        createdBy?: ObjectId;
    };
}
