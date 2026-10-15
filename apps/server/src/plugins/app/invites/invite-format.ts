import {
    InlineKeyboardButton,
    RichBlockTableCell,
    RichText,
    RichTextDateTime,
} from "@grammyjs/types";
import { formatDate } from "../../../utils/parsers.js";
import { AccessService } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { InviteEntity, InviteStatus } from "./invite-entity.js";

const statusIcons: Record<InviteStatus, string> = {
    active: "🟢",
    expired: "⌛",
    revoked: "⛔",
    full: "🔒",
};

export function formatInviteStatus(t: Translate, status: InviteStatus): string {
    switch (status) {
        case "active":
            return `${statusIcons.active} ${t("invites:statusActive")}`;
        case "expired":
            return `${statusIcons.expired} ${t("invites:statusExpired")}`;
        case "revoked":
            return `${statusIcons.revoked} ${t("invites:statusRevoked")}`;
        case "full":
            return `${statusIcons.full} ${t("invites:statusFull")}`;
    }
}

export function formatInviteLabel(
    invite: InviteEntity,
    status: InviteStatus,
): string {
    return `${statusIcons[status]} ${formatInviteUses(invite)}`;
}

export function formatInviteUses(invite: InviteEntity): string {
    return `${invite.activations.length}/${invite.maxUses ?? "∞"}`;
}

export function formatGrants(
    accessService: AccessService,
    t: Translate,
    grants: string[],
): string {
    return grants
        .map((name) => accessService.findGrant(name)?.title(t) ?? name)
        .join(", ");
}

export function richDate(date: Date, timeZone: string): RichTextDateTime {
    return {
        type: "date_time",
        text: formatDate(date, timeZone),
        unix_time: Math.floor(date.getTime() / 1000),
        date_time_format: "dt",
    };
}

export function tableCell(text: RichText): RichBlockTableCell {
    return { text, align: "left", valign: "top" };
}

export function withoutEmptyRows(
    rows: InlineKeyboardButton[][],
): InlineKeyboardButton[][] {
    return rows.filter((row) => row.length);
}
