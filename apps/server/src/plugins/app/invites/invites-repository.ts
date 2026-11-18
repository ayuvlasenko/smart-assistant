import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Collection, Document, Filter, ObjectId } from "mongodb";
import { readMongoDb } from "../../external/mongo.js";
import { InviteEntity } from "./invite-entity.js";

export type InviteData = Pick<InviteEntity, "botId" | "token" | "grants"> &
    Partial<Pick<InviteEntity, "createdBy" | "maxUses" | "expiresAt">>;

export interface InvitesPageOptions {
    filter: Filter<InviteEntity>;
    skip: number;
    limit: number;
    now: Date;
}

export class InvitesRepository {
    private readonly invites: Collection<InviteEntity>;

    constructor(invites: Collection<InviteEntity>) {
        this.invites = invites;
    }

    async create(data: InviteData): Promise<InviteEntity> {
        const invite = buildInvite(data);

        await this.invites.insertOne(invite);

        return invite;
    }

    async createIfMissing(data: InviteData): Promise<boolean> {
        const { token, ...fields } = buildInvite(data);
        const result = await this.invites.updateOne(
            { token },
            { $setOnInsert: fields },
            { upsert: true },
        );

        return result.upsertedCount > 0;
    }

    findOneById(_id: ObjectId): Promise<InviteEntity | null> {
        return this.invites.findOne({ _id });
    }

    findOne(filter: Filter<InviteEntity>): Promise<InviteEntity | null> {
        return this.invites.findOne(filter);
    }

    findOneByToken(botId: string, token: string): Promise<InviteEntity | null> {
        return this.invites.findOne({ botId, token });
    }

    activate(
        botId: string,
        token: string,
        userId: ObjectId,
        now: Date,
    ): Promise<InviteEntity | null> {
        return this.invites.findOneAndUpdate(
            {
                botId,
                token,
                "activations.userId": { $ne: userId },
                $expr: isActiveExpression(now),
            },
            {
                $push: { activations: { userId, activatedAt: now } },
                $set: { updatedAt: now },
                $inc: { version: 1 },
            },
            { returnDocument: "after" },
        );
    }

    revoke(_id: ObjectId, now: Date): Promise<InviteEntity | null> {
        return this.invites.findOneAndUpdate(
            { _id, revokedAt: { $exists: false } },
            {
                $set: { revokedAt: now, updatedAt: now },
                $inc: { version: 1 },
            },
            { returnDocument: "after" },
        );
    }

    async revokeBootstrapInvites(
        botId: string,
        now: Date,
        exceptToken?: string,
    ): Promise<number> {
        const result = await this.invites.updateMany(
            {
                botId,
                createdBy: { $exists: false },
                revokedAt: { $exists: false },
                ...(exceptToken === undefined
                    ? {}
                    : { token: { $ne: exceptToken } }),
            },
            {
                $set: { revokedAt: now, updatedAt: now },
                $inc: { version: 1 },
            },
        );

        return result.modifiedCount;
    }

    async reopen(_id: ObjectId, now: Date): Promise<void> {
        await this.invites.updateOne(
            { _id },
            {
                $unset: { revokedAt: "" },
                $set: { updatedAt: now },
                $inc: { version: 1 },
            },
        );
    }

    findPage({
        filter,
        skip,
        limit,
        now,
    }: InvitesPageOptions): Promise<InviteEntity[]> {
        return this.invites
            .aggregate<InviteEntity>([
                { $match: filter },
                { $addFields: { isActive: isActiveExpression(now) } },
                { $sort: { isActive: -1, createdAt: -1, _id: -1 } },
                { $skip: skip },
                { $limit: limit },
                { $project: { isActive: 0 } },
            ])
            .toArray();
    }

    count(filter: Filter<InviteEntity>): Promise<number> {
        return this.invites.countDocuments(filter);
    }
}

function buildInvite(data: InviteData): InviteEntity {
    const now = new Date();

    return {
        _id: new ObjectId(),
        botId: data.botId,
        token: data.token,
        grants: data.grants,
        ...(data.createdBy ? { createdBy: data.createdBy } : {}),
        ...(data.maxUses === undefined ? {} : { maxUses: data.maxUses }),
        ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
        activations: [],
        version: 0,
        createdAt: now,
        updatedAt: now,
    };
}

function isActiveExpression(now: Date): Document {
    return {
        $and: [
            { $eq: [{ $type: "$revokedAt" }, "missing"] },
            {
                $or: [
                    { $eq: [{ $type: "$expiresAt" }, "missing"] },
                    { $gt: ["$expiresAt", now] },
                ],
            },
            {
                $or: [
                    { $eq: [{ $type: "$maxUses" }, "missing"] },
                    { $lt: [{ $size: "$activations" }, "$maxUses"] },
                ],
            },
        ],
    };
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "invitesRepository",
            new InvitesRepository(
                readMongoDb(fastify).collection<InviteEntity>("invites"),
            ),
        );
    },
    {
        name: "invites-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
