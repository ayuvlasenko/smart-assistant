import { AccessControl } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { pageButtons } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    InviteEntity,
    InvitesSubjects,
    readInviteStatus,
} from "./invite-entity.js";
import {
    buildInvitesMessage,
    formatBold,
    formatGrants,
    formatInviteLabel,
    formatLabeledTime,
    pageButtonOf,
} from "./invite-format.js";
import { InvitesView } from "./invites-schemas.js";

const invitesPageSize = 5;
const invitesPerRow = 2;

export async function renderInvitesList(
    { ctx, scene, invitesService, access }: InvitesView,
    page: number,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const offset = page * invitesPageSize;
    const invites = await invitesService.list(ctx.user, {
        skip: offset,
        limit: invitesPageSize,
    });
    const now = new Date();
    const lines = invites.items.length
        ? invites.items.map((invite, index) =>
              describeListItem(
                  t,
                  ctx.timeZone,
                  access,
                  invite,
                  offset + index + 1,
                  now,
              ),
          )
        : [escapeTelegramHtml(t("invites:listEmpty"))];

    return buildInvitesMessage(
        [formatBold(t("invites:listTitle")), ...lines],
        [
            ...inRowsOf(
                invitesPerRow,
                invites.items.map((invite, index) =>
                    scene.screenButton(
                        `#${offset + index + 1} ${formatInviteLabel(invite, readInviteStatus(invite, now))}`,
                        "invite",
                        { inviteId: invite._id.toHexString() },
                    ),
                ),
            ),
            pageButtons(
                page,
                invites.total,
                invitesPageSize,
                pageButtonOf(scene),
            ),
            access.can(ctx.user, "create", "Invite")
                ? [scene.button(t("invites:newInviteButton"), "create", null)]
                : [],
        ],
    );
}

function describeListItem(
    t: Translate,
    timeZone: string,
    access: AccessControl<InvitesSubjects>,
    invite: InviteEntity,
    number: number,
    now: Date,
): string {
    const parts = [
        `<b>#${number}</b> ${escapeTelegramHtml(formatInviteLabel(invite, readInviteStatus(invite, now)))}`,
        escapeTelegramHtml(formatGrants(access, t, invite.grants)),
    ];

    if (invite.expiresAt) {
        parts.push(
            formatLabeledTime(
                t("invites:expiresLabel"),
                invite.expiresAt,
                timeZone,
            ),
        );
    }

    return parts.join(" · ");
}

function inRowsOf<TItem>(size: number, items: TItem[]): TItem[][] {
    const rows: TItem[][] = [];

    for (let index = 0; index < items.length; index += size) {
        rows.push(items.slice(index, index + size));
    }

    return rows;
}
