import {
    escapeTelegramHtml,
    measureTelegramHtml,
    telegramMessageTextLimit,
} from "../telegram/telegram-html.js";
import { pageButtons } from "../telegram/telegram-pagination.js";
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
    const header = [
        formatPokerHeader(room, ctx.timeZone, t("poker:historyTitle")),
        ...(isClosed ? [escapeTelegramHtml(t("poker:closedNote"))] : []),
        "",
    ];
    const rounds = listRevealedPokerRounds(room)
        .filter((round) => summarizePokerRound(round, deck).distribution.length)
        .toReversed()
        .map((round) => describeRound(view, round));
    const pages = splitIntoPages(
        rounds,
        telegramMessageTextLimit - measureTelegramHtml(header.join("\n")),
    );
    const page = pages[scene.state.page] ?? [];

    return buildPokerMessage(
        [
            ...header,
            ...(page.length
                ? page.flatMap((round, index) => [
                      ...(index ? [""] : []),
                      ...round,
                  ])
                : [escapeTelegramHtml(t("poker:historyEmpty"))]),
        ],
        [
            pageButtons(scene.state.page, pages.length, 1, (text, target) =>
                scene.button(text, "page", target),
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

function splitIntoPages(rounds: string[][], maxLength: number): string[][][] {
    const pages: string[][][] = [];
    let page: string[][] = [];
    let length = 0;

    for (const round of rounds) {
        const roundLength = measureTelegramHtml(round.join("\n"));

        if (
            page.length === roundsPageSize ||
            (page.length && length + 2 + roundLength > maxLength)
        ) {
            pages.push(page);
            page = [];
            length = 0;
        }

        length += (page.length ? 2 : 1) + roundLength;
        page.push(round);
    }

    return page.length ? [...pages, page] : pages;
}
