import { subject } from "@casl/ability";
import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { AccessService, adminGrant } from "../access/access-service.js";
import { AppLogger } from "../app-logger.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { InviteEntity, readInviteStatus } from "./invite-entity.js";
import {
    InviteGrantNotAllowedError,
    InviteWithoutGrantsError,
} from "./invites-errors.js";
import { InvitesEvents } from "./invites-events.js";
import { InvitesRepository } from "./invites-repository.js";

export interface InviteDraft {
    grants: string[];
    maxUses?: number;
    expiresAt?: Date;
}

export type InviteActivationResult =
    | {
          status: "activated" | "alreadyActivated";
          invite: InviteEntity;
          user: UserEntity;
      }
    | { status: "notFound" | "expired" | "revoked" | "full" };

export interface InvitesPage<TItem> {
    items: TItem[];
    total: number;
}

export interface InviteUser {
    userId: ObjectId;
    activatedAt: Date;
    user?: UserEntity;
}

export interface InvitesBootstrap {
    invite: "none" | "created" | "reopened" | "kept" | "unusable";
    revoked: number;
}

export interface InvitesPageRequest {
    skip: number;
    limit: number;
}

const inviteTokenBytes = 16;

export class InvitesService {
    private readonly invitesRepository: InvitesRepository;
    private readonly usersRepository: UsersRepository;
    private readonly accessService: AccessService;
    private readonly eventEmitter: Emittery<InvitesEvents>;

    constructor(
        invitesRepository: InvitesRepository,
        usersRepository: UsersRepository,
        accessService: AccessService,
        eventEmitter: Emittery<InvitesEvents>,
    ) {
        this.invitesRepository = invitesRepository;
        this.usersRepository = usersRepository;
        this.accessService = accessService;
        this.eventEmitter = eventEmitter;
    }

    async create(actor: UserEntity, draft: InviteDraft): Promise<InviteEntity> {
        const grants = [...new Set(draft.grants)];
        const data = {
            createdBy: actor._id,
            grants,
            maxUses: draft.maxUses,
            expiresAt: draft.expiresAt,
        };

        this.accessService.assert(actor, "create", subject("Invite", data));

        if (!grants.length) {
            throw new InviteWithoutGrantsError();
        }

        for (const grant of grants) {
            if (
                !this.accessService.findGrant(grant) ||
                !this.accessService.holds(actor, grant)
            ) {
                throw new InviteGrantNotAllowedError(grant);
            }
        }

        return this.invitesRepository.create({
            token: randomBytes(inviteTokenBytes).toString("base64url"),
            ...data,
        });
    }

    async activate(
        user: UserEntity,
        token: string,
    ): Promise<InviteActivationResult> {
        const now = new Date();
        const activated = await this.invitesRepository.activate(
            token,
            user._id,
            now,
        );

        if (activated) {
            const updated = await this.usersRepository.grantAccess(
                user._id,
                activated.grants,
            );

            await this.eventEmitter.emit("invites.inviteActivated", {
                inviteId: activated._id,
                createdBy: activated.createdBy,
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
                this.accessService.accessibleBy(actor, "read", "Invite"),
            ],
        });
    }

    async list(
        actor: UserEntity,
        { skip, limit }: InvitesPageRequest,
    ): Promise<InvitesPage<InviteEntity>> {
        const filter = this.accessService.accessibleBy(actor, "read", "Invite");
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
        { skip, limit }: InvitesPageRequest,
    ): Promise<InvitesPage<InviteUser>> {
        this.accessService.assert(actor, "read", subject("Invite", invite));

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

        this.accessService.assert(actor, "update", subject("Invite", invite));

        return this.invitesRepository.revoke(inviteId, new Date());
    }

    async bootstrap(token: string | undefined): Promise<InvitesBootstrap> {
        const now = new Date();

        if (
            !token ||
            (await this.usersRepository.existsWithGrant(adminGrant))
        ) {
            return {
                invite: "none",
                revoked:
                    await this.invitesRepository.revokeBootstrapInvites(now),
            };
        }

        const revoked = await this.invitesRepository.revokeBootstrapInvites(
            now,
            token,
        );

        return {
            invite: await this.prepareBootstrapInvite(token, now),
            revoked,
        };
    }

    private async prepareBootstrapInvite(
        token: string,
        now: Date,
    ): Promise<InvitesBootstrap["invite"]> {
        const invite = await this.invitesRepository.findOneByToken(token);

        if (!invite) {
            await this.invitesRepository.create({
                token,
                grants: [adminGrant],
                maxUses: 1,
            });

            return "created";
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
        const invite = await this.invitesRepository.findOneByToken(token);

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
                user: await this.usersRepository.grantAccess(
                    user._id,
                    invite.grants,
                ),
            };
        }

        return { status: status === "active" ? "full" : status };
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const invitesService = new InvitesService(
            fastify.getDecorator<InvitesRepository>("invitesRepository"),
            fastify.getDecorator<UsersRepository>("usersRepository"),
            fastify.getDecorator<AccessService>("accessService"),
            fastify.getDecorator<Emittery<InvitesEvents>>("eventEmitter"),
        );
        const log = fastify
            .getDecorator<AppLogger>("appLogger")
            .child({ module: "invites" });
        const inviteToken = fastify.config.INVITE_TOKEN;

        fastify.decorate("invitesService", invitesService);

        fastify.addHook("onReady", async () => {
            const { invite, revoked } =
                await invitesService.bootstrap(inviteToken);

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
            "emittery",
            "invites-repository",
            "users-repository",
        ],
    },
);

declare module "../access/access-service.js" {
    interface AccessSubjects {
        Invite: InviteEntity;
    }
}
