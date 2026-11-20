import { InlineKeyboardButton, WebhookInfo } from "@grammyjs/types";
import { Translate } from "../i18n-service.js";
import { inviteDeepLinkOf } from "../invites/invite-entity.js";
import { buildTelegramDeepLinkUrl } from "../telegram/telegram-deep-links.js";
import {
    buildTelegramHtmlMessage,
    escapeTelegramHtml,
    formatTelegramHtmlBold,
    formatTelegramHtmlLabeled,
} from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { BotEntity } from "./bot-entity.js";
import { BotsSceneControl, BotsView } from "./bots-scene.js";
import { BotsService } from "./bots-service.js";

export async function renderBotsList({
    ctx,
    scene,
    botsService,
}: BotsView): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bots = await botsService.list(ctx.user);

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(t("bots:listTitle")),
            ...bots.map((bot) =>
                escapeTelegramHtml(
                    [
                        labelOf(t, botsService, bot),
                        statusOf(t, bot),
                        `${t("bots:modulesLabel")}: ${modulesOf(t, botsService, bot)}`,
                    ].join(" · "),
                ),
            ),
        ],
        [
            ...bots.map((bot) => [
                scene.screenButton(labelOf(t, botsService, bot), "bot", {
                    botId: bot._id,
                }),
            ]),
            [scene.button(t("bots:addButton"), "add", null)],
        ],
    );
}

export async function renderBot(
    { ctx, scene, botsService }: BotsView,
    botId: string,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bot = await botsService.find(ctx.user, botId);

    if (!bot) {
        return renderMissing(t, scene);
    }

    const isRoot = botsService.isRoot(bot._id);
    const isServed = await botsService.isServed(bot._id);
    const webhook = bot.disabledAt
        ? undefined
        : await botsService.readWebhook(ctx.user, bot._id);

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(labelOf(t, botsService, bot)),
            `<code>${escapeTelegramHtml(bot.telegramId)}</code>`,
            formatTelegramHtmlLabeled(t("bots:statusLabel"), statusOf(t, bot)),
            formatTelegramHtmlLabeled(
                t("bots:modulesLabel"),
                modulesOf(t, botsService, bot),
            ),
            formatTelegramHtmlLabeled(
                t("bots:startLabel"),
                startModuleOf(t, botsService, bot),
            ),
            ...(bot.disabledAt
                ? []
                : [
                      formatTelegramHtmlLabeled(
                          t("bots:webhookLabel"),
                          describeWebhook(t, webhook),
                      ),
                  ]),
        ],
        [
            [
                scene.screenButton(t("bots:modulesButton"), "modules", {
                    botId: bot._id,
                }),
                scene.screenButton(t("bots:startModuleButton"), "startModule", {
                    botId: bot._id,
                }),
            ],
            [
                ...(isRoot || !isServed
                    ? []
                    : [
                          scene.button(
                              t("bots:ownerInviteButton"),
                              "ownerInvite",
                              bot._id,
                          ),
                      ]),
                scene.button(t("bots:webhookButton"), "webhook", bot._id),
            ],
            isRoot
                ? []
                : [
                      scene.button(t("bots:tokenButton"), "token", bot._id),
                      moveButton(t, scene, bot),
                  ],
            [
                scene.backButton(t("bots:backButton")),
                ...(isRoot ? [] : [switchButton(t, scene, bot)]),
            ],
        ],
    );
}

export async function renderBotModules(
    { ctx, scene, botsService }: BotsView,
    botId: string,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bot = await botsService.find(ctx.user, botId);

    if (!bot) {
        return renderMissing(t, scene);
    }

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(
                t("bots:modulesTitle", { bot: labelOf(t, botsService, bot) }),
            ),
        ],
        [
            ...botsService
                .listModules()
                .map((module) => [
                    scene.button(
                        `${bot.modules.includes(module.name) ? "✅" : "⬜"} ${module.title(t)}`,
                        "toggle",
                        module.name,
                    ),
                ]),
            [scene.backButton(t("bots:backButton"))],
        ],
    );
}

export async function renderBotStartModule(
    { ctx, scene, botsService }: BotsView,
    botId: string,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bot = await botsService.find(ctx.user, botId);

    if (!bot) {
        return renderMissing(t, scene);
    }

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(
                t("bots:startModuleTitle", {
                    bot: labelOf(t, botsService, bot),
                }),
            ),
            escapeTelegramHtml(t("bots:startModuleText")),
        ],
        [
            ...botsService
                .listStartModules(bot)
                .map((module) => [
                    scene.button(
                        formatChoice(
                            module.title(t),
                            bot.startModule === module.name,
                        ),
                        "pickStart",
                        module.name,
                    ),
                ]),
            [
                scene.button(
                    formatChoice(
                        t("bots:startWelcomeButton"),
                        bot.startModule === undefined,
                    ),
                    "pickStart",
                    null,
                ),
            ],
            [scene.backButton(t("bots:backButton"))],
        ],
    );
}

export async function renderBotOwnerInvite(
    { ctx, scene, botsService }: BotsView,
    botId: string,
    token: string,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bot = await botsService.find(ctx.user, botId);

    if (!bot) {
        return renderMissing(t, scene);
    }

    if (!bot.username || !(await botsService.isServed(bot._id))) {
        return buildTelegramHtmlMessage(
            [escapeTelegramHtml(t("bots:ownerInviteUnavailable"))],
            [[scene.backButton(t("bots:backButton"))]],
        );
    }

    const url = buildTelegramDeepLinkUrl(bot.username, inviteDeepLinkOf(token));

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(
                t("bots:ownerInviteTitle", {
                    bot: labelOf(t, botsService, bot),
                }),
            ),
            escapeTelegramHtml(t("bots:ownerInviteText")),
            "",
            escapeTelegramHtml(url),
        ],
        [
            [{ text: t("bots:copyLinkButton"), copy_text: { text: url } }],
            [scene.backButton(t("bots:backButton"))],
        ],
    );
}

function renderMissing(
    t: Translate,
    scene: BotsSceneControl,
): TelegramMessageContent {
    return buildTelegramHtmlMessage(
        [escapeTelegramHtml(t("bots:botMissing"))],
        [[scene.backButton(t("bots:backButton"))]],
    );
}

function labelOf(
    t: Translate,
    botsService: BotsService,
    bot: BotEntity,
): string {
    if (botsService.isRoot(bot._id)) {
        return t("bots:rootBot");
    }

    return bot.username ? `@${bot.username}` : bot.telegramId;
}

function statusOf(t: Translate, bot: BotEntity): string {
    return t(bot.disabledAt ? "bots:statusStopped" : "bots:statusActive");
}

function modulesOf(
    t: Translate,
    botsService: BotsService,
    bot: BotEntity,
): string {
    const titles = botsService
        .listModules()
        .filter(({ name }) => bot.modules.includes(name))
        .map(({ title }) => title(t));

    return titles.length ? titles.join(", ") : t("bots:none");
}

function startModuleOf(
    t: Translate,
    botsService: BotsService,
    bot: BotEntity,
): string {
    const module = botsService
        .listStartModules(bot)
        .find(({ name }) => name === bot.startModule);

    return module ? module.title(t) : t("bots:startWelcome");
}

function formatChoice(title: string, isChosen: boolean): string {
    return `${isChosen ? "🔘" : "⚪"} ${title}`;
}

function describeWebhook(
    t: Translate,
    webhook: WebhookInfo | undefined,
): string {
    if (!webhook?.url) {
        return t("bots:webhookMissing");
    }

    const state = webhook.last_error_message ?? t("bots:webhookOk");

    return webhook.pending_update_count
        ? `${state}, ${t("bots:webhookPending", { count: webhook.pending_update_count })}`
        : state;
}

function moveButton(
    t: Translate,
    scene: BotsSceneControl,
    bot: BotEntity,
): InlineKeyboardButton {
    return scene.button(
        t(
            scene.isConfirming("move", bot._id)
                ? "bots:confirmMoveButton"
                : "bots:moveButton",
        ),
        "move",
        bot._id,
    );
}

function switchButton(
    t: Translate,
    scene: BotsSceneControl,
    bot: BotEntity,
): InlineKeyboardButton {
    if (bot.disabledAt) {
        return scene.button(t("bots:startButton"), "start", bot._id);
    }

    return scene.button(
        t(
            scene.isConfirming("stop", bot._id)
                ? "bots:confirmStopButton"
                : "bots:stopButton",
        ),
        "stop",
        bot._id,
    );
}
