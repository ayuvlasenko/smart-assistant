import { InlineKeyboardButton } from "@grammyjs/types";
import { AccessService } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import {
    escapeTelegramHtml,
    formatTelegramHtmlTime,
} from "../telegram/telegram-html.js";
import { TelegramPageButton } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { InviteEntity, InviteStatus } from "./invite-entity.js";
import { InvitesSceneControl } from "./invites-schemas.js";

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

export function buildInvitesMessage(
    lines: string[],
    keyboard: InlineKeyboardButton[][],
): TelegramMessageContent {
    return {
        kind: "text",
        parse_mode: "HTML",
        text: lines.join("\n"),
        keyboard: keyboard.filter((row) => row.length),
    };
}

export function formatBold(text: string): string {
    return `<b>${escapeTelegramHtml(text)}</b>`;
}

export function formatLabeled(label: string, value: string): string {
    return `${escapeTelegramHtml(label)}: ${escapeTelegramHtml(value)}`;
}

export function formatLabeledTime(
    label: string,
    date: Date,
    timeZone: string,
): string {
    return `${escapeTelegramHtml(label)} ${formatTelegramHtmlTime(date, timeZone)}`;
}

export function pageButtonOf(scene: InvitesSceneControl): TelegramPageButton {
    return (text, target) => scene.button(text, "page", target);
}
