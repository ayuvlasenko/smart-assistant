import { subject } from "@casl/ability";
import { InlineKeyboardButton } from "@grammyjs/types";
import { ObjectId } from "mongodb";
import { Translate } from "../i18n-service.js";
import {
    escapeTelegramHtml,
    formatTelegramHtmlMention,
    formatTelegramHtmlTime,
} from "../telegram/telegram-html.js";
import { pageButtons } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { InviteEntity, readInviteStatus } from "./invite-entity.js";
import {
    buildInvitesMessage,
    formatBold,
    formatGrants,
    formatInviteStatus,
    formatInviteUses,
    formatLabeled,
    formatLabeledTime,
    pageButtonOf,
} from "./invite-format.js";
import { InvitesSceneControl, InvitesView } from "./invites-schemas.js";
import { InviteUser } from "./invites-service.js";

const usersPageSize = 10;

export async function renderInvite(
    view: InvitesView,
): Promise<TelegramMessageContent> {
    const { ctx, scene, access, resolveInviteUrl } = view;
    const { t } = ctx;
    const invite = await findInvite(view);

    if (!invite) {
        return renderMissingInvite(view);
    }

    const status = readInviteStatus(invite, new Date());
    const isActive = status === "active";
    const canRevoke = access.can(ctx.user, "update", subject("Invite", invite));
    const summary = [
        formatInviteStatus(t, status),
        formatInviteUses(invite),
    ].map(escapeTelegramHtml);

    if (invite.expiresAt) {
        summary.push(
            formatLabeledTime(
                t("invites:expiresLabel"),
                invite.expiresAt,
                ctx.timeZone,
            ),
        );
    }

    return buildInvitesMessage(
        [
            formatBold(t("invites:inviteTitle")),
            summary.join(" · "),
            formatLabeled(
                t("invites:accessLabel"),
                formatGrants(access, t, invite.grants),
            ),
            formatLabeledTime(
                t("invites:createdLabel"),
                invite.createdAt,
                ctx.timeZone,
            ),
        ],
        [
            isActive
                ? [
                      {
                          text: t("invites:copyLinkButton"),
                          copy_text: {
                              text: await resolveInviteUrl(invite.token),
                          },
                      },
                  ]
                : [],
            invite.activations.length
                ? [
                      scene.button(
                          t("invites:usersButton", {
                              count: invite.activations.length,
                          }),
                          "show",
                          "users",
                      ),
                  ]
                : [],
            [
                scene.button(t("invites:backButton"), "show", "list"),
                scene.button(t("invites:refreshButton"), "refresh", null),
            ],
            isActive && canRevoke ? [revokeButton(t, scene)] : [],
        ],
    );
}

export async function renderInviteUsers(
    view: InvitesView,
): Promise<TelegramMessageContent> {
    const { ctx, scene, invitesService } = view;
    const { t } = ctx;
    const invite = await findInvite(view);

    if (!invite) {
        return renderMissingInvite(view);
    }

    const page = await invitesService.listUsers(ctx.user, invite, {
        skip: scene.state.page * usersPageSize,
        limit: usersPageSize,
    });

    return buildInvitesMessage(
        [
            formatBold(t("invites:usersTitle")),
            ...page.items.map((item) => describeUser(t, ctx.timeZone, item)),
        ],
        [
            pageButtons(
                scene.state.page,
                page.total,
                usersPageSize,
                pageButtonOf(scene),
            ),
            [
                scene.button(t("invites:backButton"), "show", "invite"),
                scene.button(t("invites:refreshButton"), "refresh", null),
            ],
        ],
    );
}

function findInvite({
    ctx,
    scene,
    invitesService,
}: InvitesView): Promise<InviteEntity | null> | null {
    const { inviteId } = scene.state;

    return inviteId
        ? invitesService.find(ctx.user, new ObjectId(inviteId))
        : null;
}

function renderMissingInvite({
    ctx,
    scene,
}: InvitesView): TelegramMessageContent {
    return buildInvitesMessage(
        [escapeTelegramHtml(ctx.t("invites:inviteMissing"))],
        [[scene.button(ctx.t("invites:backButton"), "show", "list")]],
    );
}

function revokeButton(
    t: Translate,
    scene: InvitesSceneControl,
): InlineKeyboardButton {
    return scene.state.isRevoking
        ? {
              ...scene.button(t("invites:confirmRevokeButton"), "revoke", null),
              style: "danger",
          }
        : scene.button(t("invites:revokeButton"), "revoke", null);
}

function describeUser(
    t: Translate,
    timeZone: string,
    { userId, activatedAt, user }: InviteUser,
): string {
    const name = user
        ? formatTelegramHtmlMention(
              Number(user.telegramId),
              user.firstName ?? user.username ?? user.telegramId,
          )
        : escapeTelegramHtml(
              `${t("invites:unknownUser")} (${userId.toHexString()})`,
          );
    const username = user?.username
        ? ` @${escapeTelegramHtml(user.username)}`
        : "";

    return `${name}${username} · ${formatTelegramHtmlTime(activatedAt, timeZone)}`;
}
