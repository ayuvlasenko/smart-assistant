import { InlineKeyboardButton } from "@grammyjs/types";
import { Translate } from "../i18n-service.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    buildPokerMessage,
    formatBold,
    formatPokerAgreement,
    formatPokerDistribution,
    formatPokerHeader,
    formatPokerStats,
    inRowsOf,
} from "./poker-format.js";
import { pokerObserverIcon } from "./poker-participants-screen.js";
import {
    findPokerParticipant,
    isPokerParticipantIdle,
    listActivePokerParticipants,
    PokerParticipant,
    PokerRoomEntity,
    readPokerAutoRevealTarget,
    stepPokerAutoReveal,
} from "./poker-room-entity.js";
import { summarizePokerRound } from "./poker-round-summary.js";
import { PokerRoomView } from "./poker-schemas.js";

const maxCardsPerRow = 6;

export type PokerRoundPanel = "actions" | "menu" | "autoReveal";

export function renderPokerRound(
    view: PokerRoomView,
    panel: PokerRoundPanel,
): TelegramMessageContent {
    const isVoting = view.room.round.status === "voting";
    const lines = isVoting ? describeVoting(view) : describeRevealed(view);

    if (panel === "menu") {
        return buildPokerMessage(lines, readMenuKeyboard(view));
    }

    if (panel === "autoReveal") {
        return buildPokerMessage(
            [...lines, "", ...describeAutoReveal(view)],
            readAutoRevealKeyboard(view),
        );
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
            const icon = readParticipantIcon(
                room,
                participant,
                Boolean(votes[userId]),
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
    const isAutoReveal = room.autoReveal !== null;
    const active = listActivePokerParticipants(room).length;
    const total = readPokerAutoRevealTarget(room) ?? active;
    const voted = Object.keys(room.round.votes).length;
    const cardButton = (card: string): InlineKeyboardButton => {
        const button = scene.button(card, "vote", { round, card });

        return card === ownVote ? { ...button, style: "primary" } : button;
    };
    const reveal = scene.button(
        t(isAutoReveal ? "poker:revealAutoButton" : "poker:revealButton", {
            voted,
            total,
        }),
        "reveal",
        round,
    );

    return [
        ...(isObserver(view) ? [] : inEvenRows(deck.cards.map(cardButton))),
        [voted && voted >= active ? { ...reveal, style: "success" } : reveal],
        ...readSecondaryRows(view),
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
        ...readSecondaryRows(view),
    ];
}

function readSecondaryRows(view: PokerRoomView): InlineKeyboardButton[][] {
    const { ctx, scene } = view;
    const { t } = ctx;
    const isWatching = isObserver(view);

    return [
        [
            scene.button(
                t(isWatching ? "poker:voteButton" : "poker:watchButton"),
                "role",
                {
                    userId: ctx.user._id.toHexString(),
                    role: isWatching ? "voter" : "observer",
                },
            ),
        ],
        [
            readCopyLinkButton(view),
            scene.screenButton(t("poker:moreButton"), "menu"),
        ],
    ];
}

function isObserver({ ctx, room }: PokerRoomView): boolean {
    return findPokerParticipant(room, ctx.user._id)?.role === "observer";
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
            scene.screenButton(t("poker:historyButton"), "history", {
                page: 0,
            }),
        ],
        [
            scene.screenButton(t("poker:autoRevealButton"), "autoReveal"),
            scene.screenButton(t("poker:participantsButton"), "participants", {
                page: 0,
            }),
        ],
        [
            scene.backButton(t("poker:backButton")),
            ...(canClose
                ? [
                      {
                          ...scene.button(
                              t(
                                  scene.isConfirming("close")
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

function describeAutoReveal({ ctx, room }: PokerRoomView): string[] {
    const { t } = ctx;

    return [
        `${escapeTelegramHtml(t("poker:autoRevealLabel"))}: ${formatBold(formatAutoReveal(t, room))}`,
        escapeTelegramHtml(t("poker:autoRevealHint")),
    ];
}

function formatAutoReveal(t: Translate, room: PokerRoomEntity): string {
    if (!room.autoReveal) {
        return t("poker:autoRevealOff");
    }

    if (room.autoReveal.missingVotes === 0) {
        return t("poker:autoRevealAll");
    }

    return t("poker:autoRevealAllBut", {
        missing: room.autoReveal.missingVotes,
        votes: readPokerAutoRevealTarget(room) ?? 0,
        total: listActivePokerParticipants(room).length,
    });
}

function readAutoRevealKeyboard({
    ctx,
    scene,
    room,
}: PokerRoomView): InlineKeyboardButton[][] {
    const { t } = ctx;

    return [
        [
            scene.button(
                t("poker:fewerVotesButton"),
                "autoReveal",
                stepPokerAutoReveal(room, -1),
            ),
            scene.button(
                t("poker:moreVotesButton"),
                "autoReveal",
                stepPokerAutoReveal(room, 1),
            ),
        ],
        [scene.backButton(t("poker:backButton"))],
    ];
}

function readCopyLinkButton({
    ctx,
    roomUrl,
}: PokerRoomView): InlineKeyboardButton {
    return {
        text: ctx.t("poker:copyLinkButton"),
        copy_text: { text: roomUrl },
    };
}

function describeRoom({ ctx, room }: PokerRoomView, status: string): string[] {
    return [
        formatPokerHeader(room, ctx.timeZone, status),
        ...(room.round.title ? [escapeTelegramHtml(room.round.title)] : []),
    ];
}

function readParticipantIcon(
    room: PokerRoomEntity,
    participant: PokerParticipant,
    hasVoted: boolean,
): string {
    if (participant.role === "observer") {
        return pokerObserverIcon;
    }

    if (hasVoted) {
        return "✅";
    }

    return isPokerParticipantIdle(room, participant) ? "💤" : "⏳";
}

function inEvenRows<TItem>(items: TItem[]): TItem[][] {
    const rows = Math.ceil(items.length / maxCardsPerRow);

    return inRowsOf(Math.ceil(items.length / rows), items);
}
