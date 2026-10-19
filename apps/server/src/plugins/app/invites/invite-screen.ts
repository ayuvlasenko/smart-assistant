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
    inviteId: string,
): Promise<TelegramMessageContent> {
    const { ctx, scene, access, resolveInviteUrl } = view;
    const { t } = ctx;
    const invite = await findInvite(view, inviteId);

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
                      scene.screenButton(
                          t("invites:usersButton", {
                              count: invite.activations.length,
                          }),
                          "users",
                          { inviteId, page: 0 },
                      ),
                  ]
                : [],
            [
                scene.backButton(t("invites:backButton")),
                ...(isActive && canRevoke
                    ? [revokeButton(t, scene, inviteId)]
                    : []),
            ],
        ],
    );
}

export async function renderInviteUsers(
    view: InvitesView,
    inviteId: string,
    page: number,
): Promise<TelegramMessageContent> {
    const { ctx, scene, invitesService } = view;
    const { t } = ctx;
    const invite = await findInvite(view, inviteId);

    if (!invite) {
        return renderMissingInvite(view);
    }

    const users = await invitesService.listUsers(ctx.user, invite, {
        skip: page * usersPageSize,
        limit: usersPageSize,
    });

    return buildInvitesMessage(
        [
            formatBold(t("invites:usersTitle")),
            ...users.items.map((item) => describeUser(t, ctx.timeZone, item)),
        ],
        [
            pageButtons(page, users.total, usersPageSize, pageButtonOf(scene)),
            [scene.backButton(t("invites:backButton"))],
        ],
    );
}

function findInvite(
    { ctx, invitesService }: InvitesView,
    inviteId: string,
): Promise<InviteEntity | null> {
    return invitesService.find(ctx.user, new ObjectId(inviteId));
}

function renderMissingInvite({
    ctx,
    scene,
}: InvitesView): TelegramMessageContent {
    return buildInvitesMessage(
        [escapeTelegramHtml(ctx.t("invites:inviteMissing"))],
        [[scene.backButton(ctx.t("invites:backButton"))]],
    );
}

function revokeButton(
    t: Translate,
    scene: InvitesSceneControl,
    inviteId: string,
): InlineKeyboardButton {
    return {
        ...scene.button(
            t(
                scene.isConfirming("revoke", inviteId)
                    ? "invites:confirmRevokeButton"
                    : "invites:revokeButton",
            ),
            "revoke",
            inviteId,
        ),
        style: "danger",
    };
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
