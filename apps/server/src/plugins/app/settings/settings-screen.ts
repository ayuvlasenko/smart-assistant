import { Translate } from "../i18n-service.js";
import {
    buildTelegramHtmlMessage,
    escapeTelegramHtml,
    formatTelegramHtmlBold,
} from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { SettingsView } from "./settings-scene.js";
import {
    ChoicesSetting,
    Setting,
    SettingsService,
} from "./settings-service.js";
import { readUserChoice, UserSetting } from "./user-settings-service.js";

export async function renderOwnSettings(
    view: SettingsView,
): Promise<TelegramMessageContent> {
    const { ctx, scene, userSettingsService, canChangeBot } = view;
    const { t } = ctx;
    const sections = await userSettingsService.listSections(ctx.user.botId);

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(t("settings:title")),
            ...sections.flatMap((section) => [
                "",
                formatTelegramHtmlBold(section.title(t)),
                ...section.settings.map((setting) =>
                    escapeTelegramHtml(
                        `${setting.title(t)}: ${formatOwnValue(t, setting, view)}`,
                    ),
                ),
            ]),
        ],
        [
            ...sections
                .flatMap(({ settings }) => settings)
                .map((setting) => [
                    scene.button(
                        `${setting.emoji} ${setting.title(t)}`,
                        "openOwn",
                        setting.name,
                    ),
                ]),
            canChangeBot
                ? [scene.screenButton(t("settings:botButton"), "bot")]
                : [],
        ],
    );
}

export function renderOwnSettingChoice(
    view: SettingsView,
    setting: UserSetting,
): TelegramMessageContent {
    const { ctx, scene } = view;
    const { t } = ctx;
    const chosen = readUserChoice(setting, ctx.user);

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(t("settings:title")),
            "",
            formatTelegramHtmlBold(setting.title(t)),
        ],
        [
            ...setting
                .options(ctx.user.botId)
                .map((option) => [
                    scene.button(
                        `${option.value === chosen ? "🔘" : "⚪"} ${option.title(t)}`,
                        "pick",
                        option.value,
                    ),
                ]),
            [scene.backButton(t("settings:backButton"))],
        ],
    );
}

export async function renderBotSettings(
    view: SettingsView,
): Promise<TelegramMessageContent> {
    const { ctx, scene, settingsService } = view;
    const { t } = ctx;
    const sections = await settingsService.listSections(ctx.user.botId);
    const values = new Map(
        await Promise.all(
            sections
                .flatMap(({ settings }) => settings)
                .map(
                    async (setting) =>
                        [
                            setting.name,
                            await formatValue(
                                t,
                                setting,
                                settingsService,
                                ctx.user.botId,
                            ),
                        ] as const,
                ),
        ),
    );
    const buttons = sections
        .flatMap(({ settings }) => settings)
        .map((setting) => [
            scene.button(
                `${setting.emoji} ${setting.title(t)}`,
                "open",
                setting.name,
            ),
        ]);

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(t("settings:botTitle")),
            ...sections.flatMap((section) => [
                "",
                formatTelegramHtmlBold(section.title(t)),
                ...section.settings.map((setting) =>
                    escapeTelegramHtml(
                        `${setting.title(t)}: ${values.get(setting.name) ?? ""}`,
                    ),
                ),
            ]),
        ],
        [...buttons, [scene.backButton(t("settings:backButton"))]],
    );
}

export async function renderSettingsChoices(
    view: SettingsView,
    setting: ChoicesSetting,
): Promise<TelegramMessageContent> {
    const { ctx, scene, settingsService } = view;
    const { t } = ctx;
    const [selected, options] = await Promise.all([
        settingsService.read(setting, ctx.user.botId),
        setting.options(ctx.user.botId),
    ]);

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(t("settings:botTitle")),
            "",
            formatTelegramHtmlBold(setting.title(t)),
        ],
        [
            ...options.map((option) => [
                scene.button(
                    `${selected.includes(option.value) ? "✅" : "⬜"} ${option.title(t)}`,
                    "choose",
                    option.value,
                ),
            ]),
            [scene.backButton(t("settings:backButton"))],
        ],
    );
}

function formatOwnValue(
    t: Translate,
    setting: UserSetting,
    { ctx }: SettingsView,
): string {
    const chosen = readUserChoice(setting, ctx.user);
    const option = setting
        .options(ctx.user.botId)
        .find(({ value }) => value === chosen);

    return option ? option.title(t) : chosen;
}

async function formatValue(
    t: Translate,
    setting: Setting,
    settingsService: SettingsService,
    botId: string,
): Promise<string> {
    switch (setting.kind) {
        case "flag":
            return t(
                (await settingsService.read(setting, botId))
                    ? "settings:on"
                    : "settings:off",
            );
        case "number":
            return `${await settingsService.read(setting, botId)} (${setting.min}–${setting.max})`;
        case "choices":
            return formatChoices(
                t,
                setting,
                await settingsService.read(setting, botId),
                botId,
            );
    }
}

async function formatChoices(
    t: Translate,
    setting: ChoicesSetting,
    selected: string[],
    botId: string,
): Promise<string> {
    const titles = (await setting.options(botId))
        .filter(({ value }) => selected.includes(value))
        .map(({ title }) => title(t));

    return titles.length ? titles.join(", ") : t("settings:none");
}
