import { Language, languages, resolveLanguage } from "../i18n-service.js";
import {
    readUserChoice,
    UserChoiceSetting,
} from "../settings/user-settings-service.js";
import { UserEntity } from "./user-entity.js";

const telegramLanguage = "auto";
const languageTitles: Record<Language, string> = {
    en: "English",
    uk: "Українська",
    ru: "Русский",
};

export const languageSetting: UserChoiceSetting = {
    kind: "choice",
    name: "users.language",
    title: (t) => t("users:languageSetting"),
    emoji: "🌐",
    defaultValue: telegramLanguage,
    options: () => [
        { value: telegramLanguage, title: (t) => t("users:languageAuto") },
        ...languages.map((language) => ({
            value: language,
            title: () => languageTitles[language],
        })),
    ],
};

export function languageOf(
    user: Pick<UserEntity, "botId" | "languageCode" | "settings">,
): Language {
    return (
        resolveLanguage(readUserChoice(languageSetting, user)) ??
        user.languageCode
    );
}
