import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
    ChoicesSetting,
    SettingsService,
} from "../settings/settings-service.js";
import { AccessService, adminGrant } from "./access-service.js";

export default fp(
    async function (fastify: FastifyInstance) {
        const accessService =
            fastify.getDecorator<AccessService>("accessService");
        const settingsService =
            fastify.getDecorator<SettingsService>("settingsService");
        const access = accessService.subjects<object>();
        const defaultGrants: ChoicesSetting = {
            kind: "choices",
            name: "access.defaultGrants",
            title: (t) => t("access:defaultGrantsSetting"),
            emoji: "🔑",
            defaultValue: [],
            options: () =>
                access
                    .listSections()
                    .flatMap(({ grants }) => grants)
                    .filter(({ name }) => name !== adminGrant)
                    .map(({ name, title }) => ({ value: name, title })),
        };

        settingsService.register({
            name: "access",
            title: (t) => t("access:section"),
            settings: [defaultGrants],
        });
        accessService.useDefaultGrants(() =>
            settingsService.read(defaultGrants),
        );
    },
    {
        name: "access-default-grants",
        dependencies: ["access-service", "settings-service"],
    },
);
