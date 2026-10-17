import {
    AbilityBuilder,
    createMongoAbility,
    ForbiddenError,
    ForcedSubject,
    MongoAbility,
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

export type AccessGuard = (user: UserEntity) => boolean;

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
    register(section: AccessSection<TSubjects>): void;
    can(
        user: UserEntity,
        action: AccessAction,
        target: AccessSubject<TSubjects>,
    ): boolean;
    assert(
        user: UserEntity,
        action: AccessAction,
        target: AccessSubject<TSubjects>,
    ): void;
    accessibleBy(
        user: UserEntity,
        action: AccessAction,
        subjectName: AccessSubjectName<TSubjects>,
    ): Document;
    guard(action: AccessAction, target: AccessSubject<TSubjects>): AccessGuard;
    holds(user: UserEntity, grant: string): boolean;
    listSections(): readonly AccessSection[];
    findGrant(name: string): AccessGrant | undefined;
}

type AnySubjects = Record<string, object>;

type AnyAbility = AccessAbility<AnySubjects>;

export const adminGrant = "admin";

const noRecordsQuery: Document = { $expr: { $eq: [0, 1] } };

export class AccessService {
    private readonly sections: AccessSection[] = [];
    private readonly grants = new Map<string, AccessGrant>();
    private readonly abilities = new WeakMap<UserEntity, AnyAbility>();
    private defaultGrantsReader: (() => readonly string[]) | undefined;
    private readonly control: AccessControl<AnySubjects> = {
        register: (section) => {
            this.register(section);
        },
        can: (user, action, target) =>
            this.abilityFor(user).can(action, target),
        assert: (user, action, target) => {
            ForbiddenError.from(this.abilityFor(user)).throwUnlessCan(
                action,
                target,
            );
        },
        accessibleBy: (user, action, subjectName) =>
            this.accessibleBy(user, action, subjectName),
        guard: (action, target) => (user) =>
            this.abilityFor(user).can(action, target),
        holds: (user, grant) => this.holds(user, grant),
        listSections: () => this.sections,
        findGrant: (name) => this.grants.get(name),
    };

    subjects<TSubjects>(): AccessControl<TSubjects> {
        return this.control;
    }

    useDefaultGrants(read: () => readonly string[]): void {
        this.defaultGrantsReader = read;
    }

    private register(section: AccessSection): void {
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
    }

    private accessibleBy(
        user: UserEntity,
        action: AccessAction,
        subjectName: string,
    ): Document {
        const query = rulesToCondition<AnyAbility, Document, Document>(
            this.abilityFor(user).rulesFor(action, subjectName),
            ruleToQuery,
            {
                and: (conditions) => ({ $and: conditions }),
                or: (conditions) => ({ $or: conditions }),
                empty: () => ({}),
            },
        );

        return query ?? noRecordsQuery;
    }

    private holds(user: UserEntity, grant: string): boolean {
        return (
            !user.isBanned &&
            (user.grants.includes(grant) || user.grants.includes(adminGrant))
        );
    }

    private abilityFor(user: UserEntity): AnyAbility {
        let ability = this.abilities.get(user);

        if (!ability) {
            ability = this.buildAbility(user);
            this.abilities.set(user, ability);
        }

        return ability;
    }

    private buildAbility(user: UserEntity): AnyAbility {
        const builder = new AbilityBuilder<AnyAbility>(createMongoAbility);

        if (!user.isBanned) {
            for (const name of this.effectiveGrants(user)) {
                this.grants.get(name)?.define(builder, user);
            }
        }

        return builder.build();
    }

    private effectiveGrants(user: UserEntity): Set<string> {
        const defaults = (this.defaultGrantsReader?.() ?? []).filter(
            (name) => name !== adminGrant,
        );

        return new Set([...user.grants, ...defaults]);
    }
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
