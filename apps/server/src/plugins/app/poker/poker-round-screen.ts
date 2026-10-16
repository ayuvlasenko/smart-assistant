import { InlineKeyboardButton } from "@grammyjs/types";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    buildPokerMessage,
    formatPokerAgreement,
    formatPokerDistribution,
    formatPokerHeader,
    formatPokerStats,
    inRowsOf,
} from "./poker-format.js";
import {
    isPokerParticipantIdle,
    listActivePokerParticipants,
} from "./poker-room-entity.js";
import { summarizePokerRound } from "./poker-round-summary.js";
import { PokerRoomView } from "./poker-schemas.js";

const maxCardsPerRow = 6;

export function renderPokerRound(view: PokerRoomView): TelegramMessageContent {
    const isVoting = view.room.round.status === "voting";
    const lines = isVoting ? describeVoting(view) : describeRevealed(view);

    if (view.scene.state.screen === "menu") {
        return buildPokerMessage(lines, readMenuKeyboard(view));
    }

    return buildPokerMessage(
        lines,
        isVoting ? readVotingKeyboard(view) : readRevealedKeyboard(view),
    );
}

function describeVoting(view: PokerRoomView): string[] {
    const { ctx, room, labels } = view;
    const { t } = ctx;
    const { votes } = room.round;

    return [
        ...describeRoom(
            view,
            t("poker:roundVoting", { number: room.round.number }),
        ),
        "",
        ...room.participants.map((participant) => {
            const userId = participant.userId.toHexString();
            const icon = readVoteIcon(
                Boolean(votes[userId]),
                isPokerParticipantIdle(room, participant),
            );

            return `${escapeTelegramHtml(labels.get(userId) ?? userId)} ${icon}`;
        }),
    ];
}

function describeRevealed(view: PokerRoomView): string[] {
    const { ctx, room, deck, labels } = view;
    const { t } = ctx;
    const summary = summarizePokerRound(room.round, deck);
    const stats = formatPokerStats(t, summary);

    return [
        ...describeRoom(
            view,
            t("poker:roundRevealed", { number: room.round.number }),
        ),
        "",
        escapeTelegramHtml(formatPokerAgreement(t, summary, labels)),
        ...(summary.distribution.length
            ? ["", ...formatPokerDistribution(summary, labels)]
            : []),
        ...(stats ? ["", escapeTelegramHtml(stats)] : []),
    ];
}

function readVotingKeyboard(view: PokerRoomView): InlineKeyboardButton[][] {
    const { ctx, scene, room, deck } = view;
    const { t } = ctx;
    const round = room.round.number;
    const ownVote = room.round.votes[ctx.user._id.toHexString()];
    const total = listActivePokerParticipants(room).length;
    const voted = Object.keys(room.round.votes).length;
    const cardButton = (card: string): InlineKeyboardButton => {
        const button = scene.button(card, "vote", { round, card });

        return card === ownVote ? { ...button, style: "primary" } : button;
    };
    const reveal = scene.button(
        t(room.autoReveal ? "poker:revealAutoButton" : "poker:revealButton", {
            voted,
            total,
        }),
        "reveal",
        round,
    );

    return [
        ...inEvenRows(deck.cards.map(cardButton)),
        [voted && voted >= total ? { ...reveal, style: "success" } : reveal],
        [
            readInviteButton(view),
            scene.button(t("poker:moreButton"), "show", "menu"),
        ],
    ];
}

function readRevealedKeyboard(view: PokerRoomView): InlineKeyboardButton[][] {
    const { ctx, scene, room } = view;
    const { t } = ctx;
    const round = room.round.number;

    return [
        [
            scene.button(t("poker:revoteButton"), "startRound", {
                round,
                repeat: true,
            }),
            {
                ...scene.button(t("poker:nextRoundButton"), "startRound", {
                    round,
                    repeat: false,
                }),
                style: "primary",
            },
        ],
        [
            readInviteButton(view),
            scene.button(t("poker:moreButton"), "show", "menu"),
        ],
    ];
}

function readMenuKeyboard({
    ctx,
    scene,
    room,
    canClose,
}: PokerRoomView): InlineKeyboardButton[][] {
    const { t } = ctx;

    return [
        [
            scene.button(
                t("poker:roundTitleButton"),
                "askTitle",
                room.round.number,
            ),
            scene.button(t("poker:historyButton"), "show", "history"),
        ],
        [
            scene.button(t("poker:backButton"), "show", "round"),
            ...(canClose
                ? [
                      {
                          ...scene.button(
                              t(
                                  scene.state.isClosing
                                      ? "poker:confirmCloseButton"
                                      : "poker:closeButton",
                              ),
                              "close",
                              null,
                          ),
                          style: "danger" as const,
                      },
                  ]
                : []),
        ],
    ];
}

function readInviteButton({
    ctx,
    roomUrl,
}: PokerRoomView): InlineKeyboardButton {
    const { t } = ctx;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(roomUrl)}&text=${encodeURIComponent(t("poker:inviteText"))}`;

    return { text: t("poker:inviteButton"), url: shareUrl };
}

function describeRoom({ ctx, room }: PokerRoomView, status: string): string[] {
    return [
        formatPokerHeader(room, ctx.timeZone, status),
        ...(room.round.title ? [escapeTelegramHtml(room.round.title)] : []),
    ];
}

function readVoteIcon(hasVoted: boolean, isIdle: boolean): string {
    if (hasVoted) {
        return "✅";
    }

    return isIdle ? "💤" : "⏳";
}

function inEvenRows<TItem>(items: TItem[]): TItem[][] {
    const rows = Math.ceil(items.length / maxCardsPerRow);

    return inRowsOf(Math.ceil(items.length / rows), items);
}
