import { type Static, Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import {
    TelegramSceneControl,
    TelegramSceneInputSchemas,
} from "../telegram/telegram-scene.js";
import { InvitesSubjects } from "./invite-entity.js";
import { InvitesService } from "./invites-service.js";

const pageSchema = Type.Integer({ minimum: 0 });
const inviteIdSchema = Type.String({ pattern: "^[0-9a-f]{24}$" });

const inviteDraftSchema = Type.Object({
    grants: Type.Array(Type.String()),
    maxUses: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    validForDays: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});

export const invitesStateSchema = Type.Object({
    draft: inviteDraftSchema,
});

export const invitesScreens = {
    list: Type.Object({ page: pageSchema }),
    invite: Type.Object({ inviteId: inviteIdSchema }),
    users: Type.Object({ inviteId: inviteIdSchema, page: pageSchema }),
    form: Type.Object({}),
    sections: Type.Object({ page: pageSchema }),
    section: Type.Object({ section: Type.String(), page: pageSchema }),
    validFor: Type.Object({}),
};

export const invitesButtonValues = {
    page: pageSchema,
    revoke: inviteIdSchema,
    create: Type.Null(),
    toggle: Type.String(),
    validFor: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    askLimit: Type.Null(),
    askValidFor: Type.Null(),
    save: Type.Null(),
};

export type InvitesState = Static<typeof invitesStateSchema>;

export type InviteDraft = InvitesState["draft"];

export type InvitesSceneControl = TelegramSceneControl<
    InvitesState,
    typeof invitesButtonValues,
    TelegramSceneInputSchemas,
    typeof invitesScreens
>;

export type InviteUrlResolver = (token: string) => Promise<string>;

export interface InvitesView {
    ctx: TelegramContext;
    scene: InvitesSceneControl;
    invitesService: InvitesService;
    access: AccessControl<InvitesSubjects>;
    resolveInviteUrl: InviteUrlResolver;
}
