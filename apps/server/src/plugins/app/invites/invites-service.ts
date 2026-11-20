import { subject } from "@casl/ability";
import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { Env } from "../../../env.js";
import {
    AccessControl,
    AccessSection,
    AccessService,
    adminGrant,
} from "../access/access-service.js";
import { AppLogger } from "../app-logger.js";
import { BotsRegistry } from "../bots/bots-registry.js";
import { Page, PageRequest } from "../page.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { UsersService } from "../users/users-service.js";
import {
    InviteEntity,
    InvitesSubjects,
    readInviteStatus,
} from "./invite-entity.js";
import { InvitesEvents } from "./invites-events.js";
import { InviteData, InvitesRepository } from "./invites-repository.js";

export interface NewInvite {
    grants: string[];
    maxUses?: number;
    validForDays?: number;
}

export type InviteCreation =
    | { status: "created"; invite: InviteEntity }
    | { status: "noGrants" }
    | { status: "grantNotAllowed"; grant: string };

export type InviteActivationResult =
    | {
          status: "activated" | "alreadyActivated";
          invite: InviteEntity;
          user: UserEntity;
      }
    | { status: "notFound" | "expired" | "revoked" | "full" };

export interface InviteUser {
    userId: ObjectId;
    activatedAt: Date;
    user?: UserEntity;
}

export interface InvitesBootstrap {
    invite: "none" | "created" | "reopened" | "kept" | "unusable";
    revoked: number;
}

export const inviteMaxUsesLimit = 10_000;
export const inviteValidForDaysLimit = 365;

const inviteTokenBytes = 16;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export class InvitesService {
    private readonly invitesRepository: InvitesRepository;
    private readonly usersRepository: UsersRepository;
    private readonly usersService: UsersService;
    private readonly access: AccessControl<InvitesSubjects>;
    private readonly eventEmitter: Emittery<InvitesEvents>;
    private readonly log: FastifyBaseLogger;

    constructor(
        invitesRepository: InvitesRepository,
        usersRepository: UsersRepository,
        usersService: UsersService,
        access: AccessControl<InvitesSubjects>,
        eventEmitter: Emittery<InvitesEvents>,
        log: FastifyBaseLogger,
    ) {
        this.invitesRepository = invitesRepository;
        this.usersRepository = usersRepository;
        this.usersService = usersService;
        this.access = access;
        this.eventEmitter = eventEmitter;
        this.log = log;
    }

    async create(actor: UserEntity, draft: NewInvite): Promise<InviteCreation> {
        assertInRange("maxUses", draft.maxUses, inviteMaxUsesLimit);
        assertInRange(
            "validForDays",
            draft.validForDays,
            inviteValidForDaysLimit,
        );

        const grants = [...new Set(draft.grants)];
        const data = {
            botId: actor.botId,
            createdBy: actor._id,
            grants,
            maxUses: draft.maxUses,
            expiresAt: readExpiry(draft.validForDays),
        };

        await this.access.assert(actor, "create", subject("Invite", data));

        if (!grants.length) {
            return { status: "noGrants" };
        }

        const grantable = await this.listGrantableSections(actor);
        const notAllowed = grants.find((grant) => !isGrantIn(grantable, grant));

        if (notAllowed !== undefined) {
            return { status: "grantNotAllowed", grant: notAllowed };
        }

        const invite = await this.insert(data);

        this.log.info(
            {
                botId: invite.botId,
                inviteId: invite._id,
                userId: actor._id,
                grants,
            },
            "Invite created",
        );

        return { status: "created", invite };
    }

    async listGrantableSections(actor: UserEntity): Promise<AccessSection[]> {
        const sections = await this.access.listEnabled(
            actor.botId,
            this.access.listSections(),
        );

        return sections.flatMap((section) => {
            const grants = section.grants.filter((grant) =>
                this.access.holds(actor, grant.name),
            );

            return grants.length ? [{ ...section, grants }] : [];
        });
    }

    async canGrant(actor: UserEntity, grant: string): Promise<boolean> {
        return isGrantIn(await this.listGrantableSections(actor), grant);
    }

    createOwnerInvite(botId: string): Promise<InviteEntity> {
        return this.insert({ botId, grants: [adminGrant], maxUses: 1 });
    }

    async activate(
        user: UserEntity,
        token: string,
    ): Promise<InviteActivationResult> {
        const now = new Date();
        const activated = await this.invitesRepository.activate(
            user.botId,
            token,
            user._id,
            now,
        );

        if (activated) {
            const updated = await this.usersService.grantAccess(
                user._id,
                activated.grants,
            );

            await this.eventEmitter.emit("invites.inviteChanged", {
                botId: user.botId,
                inviteId: activated._id,
            });

            return { status: "activated", invite: activated, user: updated };
        }

        return this.explainRefusal(user, token, now);
    }

    async find(
        actor: UserEntity,
        inviteId: ObjectId,
    ): Promise<InviteEntity | null> {
        return this.invitesRepository.findOne({
            $and: [
                { _id: inviteId },
                await this.access.accessibleBy(actor, "read", "Invite"),
            ],
        });
    }

    async list(
        actor: UserEntity,
        { skip, limit }: PageRequest,
    ): Promise<Page<InviteEntity>> {
        const filter = await this.access.accessibleBy(actor, "read", "Invite");
        const [items, total] = await Promise.all([
            this.invitesRepository.findPage({
                filter,
                skip,
                limit,
                now: new Date(),
            }),
            this.invitesRepository.count(filter),
        ]);

        return { items, total };
    }

    async listUsers(
        actor: UserEntity,
        invite: InviteEntity,
        { skip, limit }: PageRequest,
    ): Promise<Page<InviteUser>> {
        await this.access.assert(actor, "read", subject("Invite", invite));

        const activations = invite.activations
            .toReversed()
            .slice(skip, skip + limit);
        const users = await this.usersRepository.findManyByIds(
            activations.map(({ userId }) => userId),
        );

        return {
            items: activations.map(({ userId, activatedAt }) => ({
                userId,
                activatedAt,
                user: users.find(({ _id }) => _id.equals(userId)),
            })),
            total: invite.activations.length,
        };
    }

    async revoke(
        actor: UserEntity,
        inviteId: ObjectId,
    ): Promise<InviteEntity | null> {
        const invite = await this.invitesRepository.findOneById(inviteId);

        if (!invite) {
            return null;
        }

        await this.access.assert(actor, "update", subject("Invite", invite));

        const revoked = await this.invitesRepository.revoke(
            inviteId,
            new Date(),
        );

        if (revoked) {
            this.log.info(
                {
                    botId: revoked.botId,
                    inviteId: revoked._id,
                    userId: actor._id,
                },
                "Invite revoked",
            );
            await this.eventEmitter.emit("invites.inviteChanged", {
                botId: actor.botId,
                inviteId: revoked._id,
            });
        }

        return revoked;
    }

    async bootstrap(
        botId: string,
        token: string | undefined,
    ): Promise<InvitesBootstrap> {
        const now = new Date();

        if (
            !token ||
            (await this.usersRepository.existsWithGrant(botId, adminGrant))
        ) {
            return {
                invite: "none",
                revoked: await this.invitesRepository.revokeBootstrapInvites(
                    botId,
                    now,
                ),
            };
        }

        const revoked = await this.invitesRepository.revokeBootstrapInvites(
            botId,
            now,
            token,
        );

        return {
            invite: await this.prepareBootstrapInvite(botId, token, now),
            revoked,
        };
    }

    private async insert(
        data: Omit<InviteData, "token">,
    ): Promise<InviteEntity> {
        const invite = await this.invitesRepository.create({
            token: randomBytes(inviteTokenBytes).toString("base64url"),
            ...data,
        });

        await this.eventEmitter.emit("invites.inviteChanged", {
            botId: invite.botId,
            inviteId: invite._id,
        });

        return invite;
    }

    private async prepareBootstrapInvite(
        botId: string,
        token: string,
        now: Date,
    ): Promise<InvitesBootstrap["invite"]> {
        const isCreated = await this.invitesRepository.createIfMissing({
            botId,
            token,
            grants: [adminGrant],
            maxUses: 1,
        });

        if (isCreated) {
            return "created";
        }

        const invite = await this.invitesRepository.findOneByToken(
            botId,
            token,
        );

        if (!invite) {
            return "unusable";
        }

        const isUnusedBootstrapInvite =
            !invite.createdBy && !invite.activations.length;

        if (invite.revokedAt && isUnusedBootstrapInvite) {
            await this.invitesRepository.reopen(invite._id, now);

            return "reopened";
        }

        return readInviteStatus(invite, now) === "active" ? "kept" : "unusable";
    }

    private async explainRefusal(
        user: UserEntity,
        token: string,
        now: Date,
    ): Promise<InviteActivationResult> {
        const invite = await this.invitesRepository.findOneByToken(
            user.botId,
            token,
        );

        if (!invite) {
            return { status: "notFound" };
        }

        const status = readInviteStatus(invite, now);
        const isUsable = status === "active" || status === "full";
        const hasActivated = invite.activations.some(({ userId }) =>
            userId.equals(user._id),
        );

        if (hasActivated && isUsable) {
            return {
                status: "alreadyActivated",
                invite,
                user: await this.usersService.grantAccess(
                    user._id,
                    invite.grants,
                ),
            };
        }

        return { status: status === "active" ? "full" : status };
    }
}

function assertInRange(
    name: string,
    value: number | undefined,
    max: number,
): void {
    if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 1 || value > max)
    ) {
        throw new Error(`Invite ${name} ${value} is outside 1 to ${max}`);
    }
}

function readExpiry(validForDays: number | undefined): Date | undefined {
    if (validForDays === undefined) {
        return;
    }

    const validForMilliseconds = validForDays * dayMilliseconds;

    return new Date(Date.now() + validForMilliseconds);
}

function isGrantIn(sections: AccessSection[], grant: string): boolean {
    return sections.some(({ grants }) =>
        grants.some(({ name }) => name === grant),
    );
}

export default fp(
    async function (fastify: FastifyInstance) {
        const log = fastify
            .getDecorator<AppLogger>("appLogger")
            .child({ module: "invites" });
        const invitesService = new InvitesService(
            fastify.getDecorator<InvitesRepository>("invitesRepository"),
            fastify.getDecorator<UsersRepository>("usersRepository"),
            fastify.getDecorator<UsersService>("usersService"),
            fastify
                .getDecorator<AccessService>("accessService")
                .subjects<InvitesSubjects>(),
            fastify.getDecorator<Emittery<InvitesEvents>>("eventEmitter"),
            log,
        );
        const config = fastify.getDecorator<Env>("config");

        fastify.decorate("invitesService", invitesService);

        fastify.addHook("onReady", async () => {
            const { invite, revoked } = await invitesService.bootstrap(
                fastify.getDecorator<BotsRegistry>("botsRegistry").rootId,
                config.INVITE_TOKEN,
            );

            if (invite === "unusable") {
                log.warn(
                    { revoked },
                    "The invite of INVITE_TOKEN can't be used any more, set a new INVITE_TOKEN",
                );
            } else if (
                invite === "created" ||
                invite === "reopened" ||
                revoked
            ) {
                log.info(
                    { invite, revoked },
                    "Bootstrap admin invites updated",
                );
            }
        });
    },
    {
        name: "invites-service",
        dependencies: [
            "@fastify/env",
            "access-service",
            "app-logger",
            "bots-registry",
            "emittery",
            "invites-repository",
            "users-repository",
            "users-service",
        ],
    },
);
