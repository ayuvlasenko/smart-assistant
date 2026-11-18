import { Translate } from "../i18n-service.js";
import {
    buildTelegramHtmlMessage,
    escapeTelegramHtml,
    formatTelegramHtmlBold,
    formatTelegramHtmlLabeled,
} from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { pokerDeckNames, readPokerDeck } from "./poker-decks.js";
import { formatPokerDeckName } from "./poker-format.js";
import { PokerDraft, PokerView } from "./poker-schemas.js";

export function renderPokerForm({
    ctx,
    scene,
}: PokerView): TelegramMessageContent {
    const { t } = ctx;
    const { draft } = scene.state;

    return buildTelegramHtmlMessage(describeDraft(t, draft), [
        [
            scene.screenButton(t("poker:deckButton"), "deck"),
            scene.button(t("poker:titleButton"), "askTitle", null),
        ],
        [scene.button(t("poker:autoRevealButton"), "autoReveal", null)],
        [
            scene.backButton(t("poker:backButton")),
            {
                ...scene.button(t("poker:createButton"), "save", null),
                style: "success",
            },
        ],
    ]);
}

export function renderPokerDeckChoice({
    ctx,
    scene,
}: PokerView): TelegramMessageContent {
    const { t } = ctx;

    return buildTelegramHtmlMessage(
        [
            ...describeDraft(t, scene.state.draft),
            "",
            escapeTelegramHtml(t("poker:chooseDeck")),
            ...pokerDeckNames.map(
                (name) =>
                    `${formatTelegramHtmlBold(formatPokerDeckName(t, name))}: ${escapeTelegramHtml(readPokerDeck(name).cards.join(" "))}`,
            ),
        ],
        [
            ...pokerDeckNames.map((name) => [
                scene.button(formatPokerDeckName(t, name), "deck", name),
            ]),
            [scene.backButton(t("poker:backButton"))],
        ],
    );
}

function describeDraft(t: Translate, draft: PokerDraft): string[] {
    return [
        formatTelegramHtmlBold(t("poker:formTitle")),
        formatTelegramHtmlLabeled(
            t("poker:deckLabel"),
            formatPokerDeckName(t, draft.deck),
        ),
        formatTelegramHtmlLabeled(t("poker:titleLabel"), formatTitle(t, draft)),
        formatTelegramHtmlLabeled(
            t("poker:autoRevealLabel"),
            t(draft.autoReveal ? "poker:autoRevealAll" : "poker:autoRevealOff"),
        ),
    ];
}

function formatTitle(t: Translate, draft: PokerDraft): string {
    return draft.title ?? t("poker:noTitle");
}
