import { RichText } from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import { AccessService } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { pageButtons } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { TelegramSceneEngine } from "../telegram/telegram-scene-engine.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { InviteEntity, readInviteStatus } from "./invite-entity.js";
import { buildInviteFormState } from "./invite-form-scene.js";
import {
    formatGrants,
    formatInviteLabel,
    formatInviteStatus,
    formatInviteUses,
    richDate,
    withoutEmptyRows,
} from "./invite-format.js";
import { buildInviteSceneState } from "./invite-scene.js";
import { InvitesService } from "./invites-service.js";

export const invitesListKey = "list";

const invitesListTtlMilliseconds = 60 * 60 * 1000;
const invitesPageSize = 5;

const invitesListStateSchema = Type.Object({
    page: Type.Integer({ minimum: 0 }),
});

export function buildInvitesListState(): Static<typeof invitesListStateSchema> {
    return { page: 0 };
}

export function createInvitesListScene(
    invitesService: InvitesService,
    accessService: AccessService,
    sceneEngine: TelegramSceneEngine,
    inviteScene: TelegramScene,
    inviteFormScene: TelegramScene,
): TelegramScene<typeof invitesListStateSchema> {
    const canCreateInvites = accessService.guard("create", "Invite");

    return defineScene({
        name: "invites.list",
        state: invitesListStateSchema,
        ttl: invitesListTtlMilliseconds,
        guard: accessService.guard("read", "Invite"),
        key: () => invitesListKey,
        slots: {
            list: async (ctx, scene): Promise<TelegramMessageContent> => {
                const offset = scene.state.page * invitesPageSize;
                const page = await invitesService.list(ctx.user, {
                    skip: offset,
                    limit: invitesPageSize,
                });
                const now = new Date();

                return {
                    kind: "rich",
                    message: {
                        blocks: [
                            {
                                type: "heading",
                                size: 3,
                                text: ctx.t("invites:listTitle"),
                            },
                            page.items.length
                                ? {
                                      type: "list",
                                      items: page.items.map(
                                          (invite, index) => ({
                                              blocks: [
                                                  {
                                                      type: "paragraph",
                                                      text: describeInvite(
                                                          ctx.t,
                                                          ctx.timeZone,
                                                          accessService,
                                                          invite,
                                                          offset + index + 1,
                                                          now,
                                                      ),
                                                  },
                                              ],
                                          }),
                                      ),
                                  }
                                : {
                                      type: "paragraph",
                                      text: ctx.t("invites:listEmpty"),
                                  },
                        ],
                    },
                    keyboard: withoutEmptyRows([
                        ...page.items.map((invite, index) => [
                            scene.button(
                                `#${offset + index + 1} ${formatInviteLabel(invite, readInviteStatus(invite, now))}`,
                                "open",
                                invite._id.toHexString(),
                            ),
                        ]),
                        pageButtons(
                            scene.state.page,
                            page.total,
                            invitesPageSize,
                            (text, target) =>
                                scene.button(text, "page", target),
                        ),
                        canCreateInvites(ctx.user)
                            ? [
                                  scene.button(
                                      ctx.t("invites:newInviteButton"),
                                      "create",
                                      null,
                                  ),
                              ]
                            : [],
                    ]),
                };
            },
        },
        buttons: {
            open: {
                value: Type.String({ pattern: "^[0-9a-f]{24}$" }),
                handle: async (ctx, scene, inviteId) => {
                    await sceneEngine.start(
                        ctx,
                        inviteScene,
                        buildInviteSceneState(new ObjectId(inviteId)),
                    );
                },
            },
            page: {
                value: Type.Integer({ minimum: 0 }),
                handle: async (ctx, scene, page) => {
                    scene.state.page = page;
                },
            },
            create: {
                value: Type.Null(),
                guard: canCreateInvites,
                handle: async (ctx) => {
                    await sceneEngine.start(
                        ctx,
                        inviteFormScene,
                        buildInviteFormState(),
                    );
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
    number: number,
    now: Date,
): RichText[] {
    return [
        { type: "bold", text: `#${number}` },
        ` · ${formatInviteStatus(t, readInviteStatus(invite, now))}`,
        ` · ${formatInviteUses(invite)}`,
        ` · ${formatGrants(accessService, t, invite.grants)}`,
        ...(invite.expiresAt
            ? [
                  ` · ${t("invites:expiresLabel")} `,
                  richDate(invite.expiresAt, timeZone),
              ]
            : []),
    ];
}
