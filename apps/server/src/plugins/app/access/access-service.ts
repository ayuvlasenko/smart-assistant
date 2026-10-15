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

export interface AccessSubjects {
    all: never;
}

export type AccessAction =
    "manage" | "create" | "read" | "update" | "delete" | "use";

export type AccessSubjectName = Extract<keyof AccessSubjects, string>;

export type AccessSubjectOf<TName extends AccessSubjectName> =
    ForcedSubject<TName> & Partial<AccessSubjects[TName]>;

export type AccessSubject =
    | AccessSubjectName
    | {
          [TName in AccessSubjectName]: AccessSubjectOf<TName>;
      }[AccessSubjectName];

export type AppAbility = MongoAbility<[AccessAction, AccessSubject]>;

export type AccessRules = Pick<AbilityBuilder<AppAbility>, "can" | "cannot">;

export type AccessGuard = (user: UserEntity) => boolean;

export interface AccessGrant {
    name: string;
    title: (t: Translate) => string;
    define: (rules: AccessRules, user: UserEntity) => void;
}

export interface AccessSection {
    name: string;
    title: (t: Translate) => string;
    grants: AccessGrant[];
}

export const adminGrant = "admin";

const noRecordsQuery: Document = { $expr: { $eq: [0, 1] } };

export class AccessService {
    private readonly sections: AccessSection[] = [];
    private readonly grants = new Map<string, AccessGrant>();
    private readonly abilities = new WeakMap<UserEntity, AppAbility>();

    register(section: AccessSection): void {
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

    listSections(): readonly AccessSection[] {
        return this.sections;
    }

    findGrant(name: string): AccessGrant | undefined {
        return this.grants.get(name);
    }

    can(
        user: UserEntity,
        action: AccessAction,
        target: AccessSubject,
    ): boolean {
        return this.abilityFor(user).can(action, target);
    }

    assert(
        user: UserEntity,
        action: AccessAction,
        target: AccessSubject,
    ): void {
        ForbiddenError.from(this.abilityFor(user)).throwUnlessCan(
            action,
            target,
        );
    }

    accessibleBy(
        user: UserEntity,
        action: AccessAction,
        subjectName: AccessSubjectName,
    ): Document {
        const query = rulesToCondition<AppAbility, Document, Document>(
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

    guard(action: AccessAction, target: AccessSubject): AccessGuard {
        return (user) => this.can(user, action, target);
    }

    holds(user: UserEntity, grant: string): boolean {
        return (
            !user.isBanned &&
            (user.grants.includes(grant) || user.grants.includes(adminGrant))
        );
    }

    abilityFor(user: UserEntity): AppAbility {
        let ability = this.abilities.get(user);

        if (!ability) {
            ability = this.buildAbility(user);
            this.abilities.set(user, ability);
        }

        return ability;
    }

    private buildAbility(user: UserEntity): AppAbility {
        const builder = new AbilityBuilder<AppAbility>(createMongoAbility);

        if (!user.isBanned) {
            for (const name of user.grants) {
                this.grants.get(name)?.define(builder, user);
            }
        }

        return builder.build();
    }
}

function ruleToQuery(rule: RuleOf<AppAbility>): Document {
    const conditions = rule.conditions ?? {};

    return rule.inverted ? { $nor: [conditions] } : conditions;
}

export default fp(
    async function (fastify: FastifyInstance) {
        const accessService = new AccessService();

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("access", accessLocales);

        accessService.register({
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
