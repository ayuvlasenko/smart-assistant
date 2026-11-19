import {
    AbilityBuilder,
    createMongoAbility,
    ForbiddenError,
    ForcedSubject,
    MongoAbility,
    RawRuleOf,
    RuleOf,
} from "@casl/ability";
import { rulesToCondition } from "@casl/ability/extra";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Document } from "mongodb";
import { I18nService, Translate } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import { accessLocales } from "./access-locales.js";

export type AccessAction =
    "manage" | "create" | "read" | "update" | "delete" | "use";

export type AccessSubjectName<TSubjects> = Extract<keyof TSubjects, string>;

export type AccessSubject<TSubjects> =
    | AccessSubjectName<TSubjects>
    | "all"
    | {
          [TName in AccessSubjectName<TSubjects>]: ForcedSubject<TName> &
              Partial<TSubjects[TName]>;
      }[AccessSubjectName<TSubjects>];

export type AccessAbility<TSubjects> = MongoAbility<
    [AccessAction, AccessSubject<TSubjects>]
>;

export type AccessRules<TSubjects> = Pick<
    AbilityBuilder<AccessAbility<TSubjects>>,
    "can" | "cannot"
>;

export type AccessGuard = (user: UserEntity) => Promise<boolean>;

export interface AccessGrant<TSubjects = AnySubjects> {
    name: string;
    title: (t: Translate) => string;
    define: (rules: AccessRules<TSubjects>, user: UserEntity) => void;
}

export interface AccessSection<TSubjects = AnySubjects> {
    name: string;
    title: (t: Translate) => string;
    grants: AccessGrant<TSubjects>[];
}

export interface AccessControl<TSubjects> {
    register(
        section: AccessSection<TSubjects>,
        module?: { subjects: AccessSubjectName<TSubjects>[] },
    ): void;
    can(
        user: UserEntity,
        action: AccessAction,
        target: AccessSubject<TSubjects>,
    ): Promise<boolean>;
    assert(
        user: UserEntity,
        action: AccessAction,
        target: AccessSubject<TSubjects>,
    ): Promise<void>;
    accessibleBy(
        user: UserEntity,
        action: AccessAction,
        subjectName: AccessSubjectName<TSubjects>,
    ): Promise<Document>;
    guard(action: AccessAction, target: AccessSubject<TSubjects>): AccessGuard;
    holds(user: UserEntity, grant: string): boolean;
    listEnabled<TSection extends { name: string }>(
        botId: string,
        sections: readonly TSection[],
    ): Promise<TSection[]>;
    listSections(): readonly AccessSection[];
    listModules(): readonly AccessSection[];
    findGrant(name: string): AccessGrant | undefined;
}

type AnySubjects = Record<string, object>;

type AnyAbility = AccessAbility<AnySubjects>;

export const adminGrant = "admin";

const noRecordsQuery: Document = { $expr: { $eq: [0, 1] } };

export class AccessService {
    private readonly sections: AccessSection[] = [];
    private readonly grants = new Map<string, AccessGrant>();
    private readonly modules = new Map<string, readonly string[]>();
    private readonly abilities = new WeakMap<UserEntity, Promise<AnyAbility>>();
    private defaultGrantsReader:
        ((botId: string) => Promise<readonly string[]>) | undefined;
    private modulesReader:
        ((botId: string) => Promise<readonly string[]>) | undefined;
    private readonly control: AccessControl<AnySubjects> = {
        register: (section, module) => {
            this.register(section, module?.subjects);
        },
        can: async (user, action, target) =>
            (await this.abilityFor(user)).can(action, target),
        assert: async (user, action, target) => {
            ForbiddenError.from(await this.abilityFor(user)).throwUnlessCan(
                action,
                target,
            );
        },
        accessibleBy: (user, action, subjectName) =>
            this.accessibleBy(user, action, subjectName),
        guard: (action, target) => async (user) =>
            (await this.abilityFor(user)).can(action, target),
        holds: (user, grant) => this.holds(user, grant),
        listEnabled: (botId, sections) => this.listEnabled(botId, sections),
        listSections: () => this.sections,
        listModules: () =>
            this.sections.filter(({ name }) => this.modules.has(name)),
        findGrant: (name) => this.grants.get(name),
    };

    subjects<TSubjects>(): AccessControl<TSubjects> {
        return this.control;
    }

    useDefaultGrants(
        read: (botId: string) => Promise<readonly string[]>,
    ): void {
        this.defaultGrantsReader = read;
    }

    useModules(read: (botId: string) => Promise<readonly string[]>): void {
        this.modulesReader = read;
    }

    private register(
        section: AccessSection,
        moduleSubjects: readonly string[] | undefined,
    ): void {
        if (this.sections.some(({ name }) => name === section.name)) {
            throw new Error(
                `Access section "${section.name}" is already registered`,
            );
        }

        for (const grant of section.grants) {
            if (this.grants.has(grant.name)) {
                throw new Error(
                    `Access grant "${grant.name}" is already registered`,
                );
            }
        }

        this.sections.push(section);

        for (const grant of section.grants) {
            this.grants.set(grant.name, grant);
        }

        if (moduleSubjects) {
            this.modules.set(section.name, moduleSubjects);
        }
    }

    private async accessibleBy(
        user: UserEntity,
        action: AccessAction,
        subjectName: string,
    ): Promise<Document> {
        const ability = await this.abilityFor(user);
        const query = rulesToCondition<AnyAbility, Document, Document>(
            ability.rulesFor(action, subjectName),
            ruleToQuery,
            {
                and: (conditions) => ({ $and: conditions }),
                or: (conditions) => ({ $or: conditions }),
                empty: () => ({}),
            },
        );

        return query ?? noRecordsQuery;
    }

    private async listEnabled<TSection extends { name: string }>(
        botId: string,
        sections: readonly TSection[],
    ): Promise<TSection[]> {
        const modules = await this.readModules(botId);

        return sections.filter(({ name }) => this.isOn(modules, name));
    }

    private isOn(modules: readonly string[], sectionName: string): boolean {
        return !this.modules.has(sectionName) || modules.includes(sectionName);
    }

    private async readModules(botId: string): Promise<readonly string[]> {
        return (await this.modulesReader?.(botId)) ?? [];
    }

    private async readDefaultGrants(botId: string): Promise<readonly string[]> {
        return (await this.defaultGrantsReader?.(botId)) ?? [];
    }

    private holds(user: UserEntity, grant: string): boolean {
        return (
            !user.isBanned &&
            (user.grants.includes(grant) || user.grants.includes(adminGrant))
        );
    }

    private abilityFor(user: UserEntity): Promise<AnyAbility> {
        let ability = this.abilities.get(user);

        if (!ability) {
            ability = this.buildAbility(user);
            this.abilities.set(user, ability);
        }

        return ability;
    }

    private async buildAbility(user: UserEntity): Promise<AnyAbility> {
        const [modules, defaultGrants] = await Promise.all([
            this.readModules(user.botId),
            this.readDefaultGrants(user.botId),
        ]);
        const builder = new AbilityBuilder<AnyAbility>(createMongoAbility);

        if (!user.isBanned) {
            for (const name of effectiveGrants(user, defaultGrants)) {
                this.grants.get(name)?.define(builder, user);
            }
        }

        return createMongoAbility([
            ...builder.rules.map((rule) => limitToBot(rule, user.botId)),
            ...this.disabledModuleRules(modules),
        ]);
    }

    private disabledModuleRules(
        modules: readonly string[],
    ): RawRuleOf<AnyAbility>[] {
        return [...this.modules]
            .filter(([name]) => !modules.includes(name))
            .map(([, subjects]) => ({
                action: "manage",
                subject: [...subjects],
                inverted: true,
            }));
    }
}

function effectiveGrants(
    user: UserEntity,
    defaultGrants: readonly string[],
): Set<string> {
    return new Set([
        ...user.grants,
        ...defaultGrants.filter((name) => name !== adminGrant),
    ]);
}

function limitToBot(
    rule: RawRuleOf<AnyAbility>,
    botId: string,
): RawRuleOf<AnyAbility> {
    return rule.inverted
        ? rule
        : { ...rule, conditions: { ...rule.conditions, botId } };
}

function ruleToQuery(rule: RuleOf<AnyAbility>): Document {
    const conditions = rule.conditions ?? {};

    return rule.inverted ? { $nor: [conditions] } : conditions;
}

export default fp(
    async function (fastify: FastifyInstance) {
        const accessService = new AccessService();

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("access", accessLocales);

        accessService.subjects<object>().register({
            name: "access",
            title: (t) => t("access:section"),
            grants: [
                {
                    name: adminGrant,
                    title: (t) => t("access:adminGrant"),
                    define: ({ can }) => {
                        can("manage", "all");
                    },
                },
            ],
        });

        fastify.decorate("accessService", accessService);
    },
    {
        name: "access-service",
        dependencies: ["i18n-service"],
    },
);
