import { type Static, Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { TelegramSceneControl } from "../telegram/telegram-scene.js";
import { InvitesSubjects } from "./invite-entity.js";
import { InvitesService } from "./invites-service.js";

const invitesScreenSchema = Type.Union([
    Type.Literal("list"),
    Type.Literal("invite"),
    Type.Literal("users"),
    Type.Literal("form"),
    Type.Literal("sections"),
    Type.Literal("section"),
    Type.Literal("validFor"),
]);

const inviteDraftSchema = Type.Object({
    grants: Type.Array(Type.String()),
    maxUses: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    validForDays: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});

export const invitesStateSchema = Type.Object({
    screen: invitesScreenSchema,
    listPage: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 0 }),
    inviteId: Type.Union([Type.String(), Type.Null()]),
    isRevoking: Type.Boolean(),
    section: Type.Union([Type.String(), Type.Null()]),
    draft: inviteDraftSchema,
});

export const invitesButtonValues = {
    show: invitesScreenSchema,
    open: Type.String({ pattern: "^[0-9a-f]{24}$" }),
    listPage: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 0 }),
    revoke: Type.Null(),
    create: Type.Null(),
    section: Type.String(),
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
    typeof invitesButtonValues
>;

export type InviteUrlResolver = (token: string) => Promise<string>;

export interface InvitesView {
    ctx: TelegramContext;
    scene: InvitesSceneControl;
    invitesService: InvitesService;
    access: AccessControl<InvitesSubjects>;
    resolveInviteUrl: InviteUrlResolver;
}
