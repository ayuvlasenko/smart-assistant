import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { pageButtons, pageOf } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    buildPokerMessage,
    formatBold,
    formatPokerAgreementIcon,
    formatPokerDistribution,
    formatPokerHeader,
} from "./poker-format.js";
import { listRevealedPokerRounds, PokerRound } from "./poker-room-entity.js";
import { summarizePokerRound } from "./poker-round-summary.js";
import { PokerRoomView } from "./poker-schemas.js";

const roundsPageSize = 5;

export function renderPokerHistory(
    view: PokerRoomView,
    { isClosed }: { isClosed: boolean },
): TelegramMessageContent {
    const { ctx, scene, room, deck } = view;
    const { t } = ctx;
    const rounds = listRevealedPokerRounds(room)
        .filter((round) => summarizePokerRound(round, deck).distribution.length)
        .toReversed();
    const page = pageOf(rounds, scene.state.page, roundsPageSize);

    return buildPokerMessage(
        [
            formatPokerHeader(room, ctx.timeZone, t("poker:historyTitle")),
            ...(isClosed ? [escapeTelegramHtml(t("poker:closedNote"))] : []),
            "",
            ...(page.items.length
                ? page.items.flatMap((round, index) => [
                      ...(index ? [""] : []),
                      ...describeRound(view, round),
                  ])
                : [escapeTelegramHtml(t("poker:historyEmpty"))]),
        ],
        [
            pageButtons(
                scene.state.page,
                page.total,
                roundsPageSize,
                (text, target) => scene.button(text, "page", target),
            ),
            isClosed
                ? [scene.button(t("poker:hideButton"), "hide", null)]
                : [scene.button(t("poker:backButton"), "show", "round")],
        ],
    );
}

function describeRound(
    { ctx, deck, labels }: PokerRoomView,
    round: PokerRound,
): string[] {
    const { t } = ctx;
    const summary = summarizePokerRound(round, deck);
    const name = [
        t("poker:historyRound", { number: round.number }),
        ...(round.title ? [round.title] : []),
    ].join(" · ");
    const result = [
        formatPokerAgreementIcon(summary),
        ...(summary.median === undefined
            ? []
            : [t("poker:median", { value: summary.median })]),
    ].join(" ");

    return [
        `${formatBold(name)} ${escapeTelegramHtml(result)}`,
        ...formatPokerDistribution(summary, labels),
    ];
}
