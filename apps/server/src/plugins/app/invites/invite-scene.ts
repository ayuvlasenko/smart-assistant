import { subject } from "@casl/ability";
import { RichBlockTableCell, RichText } from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import { AccessService } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { pageButtons } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { InviteEntity, readInviteStatus } from "./invite-entity.js";
import {
    formatGrants,
    formatInviteStatus,
    formatInviteUses,
    richDate,
    tableCell,
    withoutEmptyRows,
} from "./invite-format.js";
import { InvitesService, InviteUser } from "./invites-service.js";

const inviteSceneTtlMilliseconds = 24 * 60 * 60 * 1000;
const usersPageSize = 10;

const inviteViewSchema = Type.Union([
    Type.Literal("summary"),
    Type.Literal("users"),
]);

const inviteStateSchema = Type.Object({
    inviteId: Type.String(),
    view: inviteViewSchema,
    page: Type.Integer({ minimum: 0 }),
    isRevoking: Type.Boolean(),
});

export type InviteSceneState = Static<typeof inviteStateSchema>;

export function buildInviteSceneState(inviteId: ObjectId): InviteSceneState {
    return {
        inviteId: inviteId.toHexString(),
        view: "summary",
        page: 0,
        isRevoking: false,
    };
}

export function createInviteScene(
    invitesService: InvitesService,
    accessService: AccessService,
    resolveInviteUrl: (token: string) => Promise<string>,
): TelegramScene<typeof inviteStateSchema> {
    const canRevokeInvites = accessService.guard("update", "Invite");

    return defineScene({
        name: "invites.invite",
        state: inviteStateSchema,
        ttl: inviteSceneTtlMilliseconds,
        guard: accessService.guard("read", "Invite"),
        key: (state) => state.inviteId,
        slots: {
            invite: async (ctx, scene): Promise<TelegramMessageContent> => {
                const invite = await invitesService.find(
                    ctx.user,
                    new ObjectId(scene.state.inviteId),
                );

                if (!invite) {
                    return {
                        kind: "text",
                        text: ctx.t("invites:inviteMissing"),
                    };
                }

                if (scene.state.view === "users") {
                    const page = await invitesService.listUsers(
                        ctx.user,
                        invite,
                        {
                            skip: scene.state.page * usersPageSize,
                            limit: usersPageSize,
                        },
                    );

                    return {
                        kind: "rich",
                        message: {
                            blocks: [
                                {
                                    type: "heading",
                                    size: 3,
                                    text: ctx.t("invites:usersTitle"),
                                },
                                {
                                    type: "list",
                                    items: page.items.map((item) => ({
                                        blocks: [
                                            {
                                                type: "paragraph",
                                                text: describeUser(
                                                    ctx.t,
                                                    ctx.timeZone,
                                                    item,
                                                ),
                                            },
                                        ],
                                    })),
                                },
                            ],
                        },
                        keyboard: withoutEmptyRows([
                            pageButtons(
                                scene.state.page,
                                page.total,
                                usersPageSize,
                                (text, target) =>
                                    scene.button(text, "page", target),
                            ),
                            [
                                scene.button(
                                    ctx.t("invites:backButton"),
                                    "view",
                                    "summary",
                                ),
                                scene.button(
                                    ctx.t("invites:refreshButton"),
                                    "refresh",
                                    null,
                                ),
                            ],
                        ]),
                    };
                }

                const link = await resolveInviteUrl(invite.token);
                const isActive =
                    readInviteStatus(invite, new Date()) === "active";
                const canRevoke = accessService.can(
                    ctx.user,
                    "update",
                    subject("Invite", invite),
                );

                return {
                    kind: "rich",
                    message: {
                        blocks: [
                            {
                                type: "heading",
                                size: 3,
                                text: ctx.t("invites:inviteTitle"),
                            },
                            {
                                type: "paragraph",
                                text: { type: "code", text: link },
                            },
                            {
                                type: "table",
                                is_bordered: true,
                                cells: describeInvite(
                                    ctx.t,
                                    ctx.timeZone,
                                    accessService,
                                    invite,
                                ),
                            },
                        ],
                    },
                    keyboard: withoutEmptyRows([
                        isActive
                            ? [
                                  {
                                      text: ctx.t("invites:copyLinkButton"),
                                      copy_text: { text: link },
                                  },
                              ]
                            : [],
                        invite.activations.length
                            ? [
                                  scene.button(
                                      ctx.t("invites:usersButton", {
                                          count: invite.activations.length,
                                      }),
                                      "view",
                                      "users",
                                  ),
                              ]
                            : [],
                        [
                            scene.button(
                                ctx.t("invites:refreshButton"),
                                "refresh",
                                null,
                            ),
                        ],
                        isActive && canRevoke
                            ? [
                                  scene.state.isRevoking
                                      ? {
                                            ...scene.button(
                                                ctx.t(
                                                    "invites:confirmRevokeButton",
                                                ),
                                                "revoke",
                                                null,
                                            ),
                                            style: "danger",
                                        }
                                      : scene.button(
                                            ctx.t("invites:revokeButton"),
                                            "revoke",
                                            null,
                                        ),
                              ]
                            : [],
                    ]),
                };
            },
        },
        buttons: {
            view: {
                value: inviteViewSchema,
                handle: async (ctx, scene, view) => {
                    scene.state.view = view;
                    scene.state.page = 0;
                    scene.state.isRevoking = false;
                },
            },
            page: {
                value: Type.Integer({ minimum: 0 }),
                handle: async (ctx, scene, page) => {
                    scene.state.page = page;
                },
            },
            refresh: {
                value: Type.Null(),
                handle: async () => undefined,
            },
            revoke: {
                value: Type.Null(),
                guard: canRevokeInvites,
                handle: async (ctx, scene) => {
                    if (!scene.state.isRevoking) {
                        scene.state.isRevoking = true;
                        return;
                    }

                    await invitesService.revoke(
                        ctx.user,
                        new ObjectId(scene.state.inviteId),
                    );
                    scene.state.isRevoking = false;
                },
            },
        },
    });
}

function describeInvite(
    t: Translate,
    timeZone: string,
    accessService: AccessService,
    invite: InviteEntity,
): RichBlockTableCell[][] {
    return [
        [
            tableCell(t("invites:statusLabel")),
            tableCell(
                formatInviteStatus(t, readInviteStatus(invite, new Date())),
            ),
        ],
        [
            tableCell(t("invites:usersLabel")),
            tableCell(formatInviteUses(invite)),
        ],
        [
            tableCell(t("invites:expiresLabel")),
            tableCell(
                invite.expiresAt
                    ? richDate(invite.expiresAt, timeZone)
                    : t("invites:never"),
            ),
        ],
        [
            tableCell(t("invites:createdLabel")),
            tableCell(richDate(invite.createdAt, timeZone)),
        ],
        [
            tableCell(t("invites:accessLabel")),
            tableCell(formatGrants(accessService, t, invite.grants)),
        ],
    ];
}

function describeUser(
    t: Translate,
    timeZone: string,
    { userId, activatedAt, user }: InviteUser,
): RichText[] {
    const name = user
        ? {
              type: "text_mention" as const,
              text: user.firstName ?? user.username ?? user.telegramId,
              user: {
                  id: Number(user.telegramId),
                  is_bot: false,
                  first_name: user.firstName ?? "",
              },
          }
        : `${t("invites:unknownUser")} (${userId.toHexString()})`;

    return [
        name,
        ...(user?.username ? [` @${user.username}`] : []),
        " · ",
        richDate(activatedAt, timeZone),
    ];
}
