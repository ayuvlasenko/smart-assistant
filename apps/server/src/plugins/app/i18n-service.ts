import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import i18next, { i18n, ResourceNamespaceMap } from "i18next";

export const languages = ["en", "uk", "ru"] as const;
export const defaultLanguage: Language = "en";

export type Language = (typeof languages)[number];

export type Translate = ReturnType<I18nService["getT"]>;

export type Translations<T> = {
    [Key in keyof T]: T[Key] extends string ? string : Translations<T[Key]>;
};

export type Locales<T> = { en: T } & Record<
    Exclude<Language, "en">,
    Translations<T>
>;

export function resolveLanguage(
    languageCode: string | undefined,
): Language | undefined {
    const [baseLanguage] = languageCode?.toLowerCase().split("-") ?? [];

    return languages.find((language) => language === baseLanguage);
}

export class I18nService {
    private readonly instance: i18n;

    constructor(instance: i18n) {
        this.instance = instance;
    }

    addLocales<TNamespace extends keyof ResourceNamespaceMap>(
        namespace: TNamespace,
        locales: Locales<ResourceNamespaceMap[TNamespace]>,
    ): void {
        for (const language of languages) {
            this.instance.addResourceBundle(
                language,
                namespace,
                locales[language],
            );
        }
    }

    getT(language: Language) {
        return this.instance.getFixedT(language);
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const instance = i18next.createInstance();

        await instance.init({
            fallbackLng: defaultLanguage,
            supportedLngs: languages,
            resources: {},
            interpolation: { escapeValue: false },
        });

        fastify.decorate("i18nService", new I18nService(instance));
    },
    {
        name: "i18n-service",
    },
);
