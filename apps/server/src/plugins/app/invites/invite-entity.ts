import { ObjectId } from "mongodb";
import { BaseEntity } from "../../../types/entities/base-entity.js";

export interface InviteActivation {
    userId: ObjectId;
    activatedAt: Date;
}

export interface InviteEntity extends BaseEntity {
    token: string;
    createdBy?: ObjectId;
    grants: string[];
    maxUses?: number;
    expiresAt?: Date;
    revokedAt?: Date;
    activations: InviteActivation[];
}

export interface InvitesSubjects {
    Invite: InviteEntity;
}

export type InviteStatus = "active" | "expired" | "revoked" | "full";

export function readInviteStatus(
    invite: InviteEntity,
    now: Date,
): InviteStatus {
    if (invite.revokedAt) {
        return "revoked";
    }

    if (invite.expiresAt && invite.expiresAt <= now) {
        return "expired";
    }

    if (
        invite.maxUses !== undefined &&
        invite.activations.length >= invite.maxUses
    ) {
        return "full";
    }

    return "active";
}
