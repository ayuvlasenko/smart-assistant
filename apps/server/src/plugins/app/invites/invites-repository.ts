import { FastifyMongoObject } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ClientSession, Document, Filter, ObjectId } from "mongodb";
import { InviteEntity } from "./invite-entity.js";

export type InviteData = Pick<InviteEntity, "token" | "grants"> &
    Partial<Pick<InviteEntity, "createdBy" | "maxUses" | "expiresAt">>;

export interface InvitesPageOptions {
    filter: Filter<InviteEntity>;
    skip: number;
    limit: number;
    now: Date;
}

export class InvitesRepository {
    readonly mongo: Required<FastifyMongoObject>;

    constructor(mongo: Required<FastifyMongoObject>) {
        this.mongo = mongo;
    }

    async create(
        data: InviteData,
        session?: ClientSession,
    ): Promise<InviteEntity> {
        const now = new Date();
        const invite: InviteEntity = {
            _id: new ObjectId(),
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

        await this.collection().insertOne(invite, { session });

        return invite;
    }

    findOneById(
        _id: ObjectId,
        session?: ClientSession,
    ): Promise<InviteEntity | null> {
        return this.collection().findOne({ _id }, { session });
    }

    findOne(
        filter: Filter<InviteEntity>,
        session?: ClientSession,
    ): Promise<InviteEntity | null> {
        return this.collection().findOne(filter, { session });
    }

    findOneByToken(
        token: string,
        session?: ClientSession,
    ): Promise<InviteEntity | null> {
        return this.collection().findOne({ token }, { session });
    }

    activate(
        token: string,
        userId: ObjectId,
        now: Date,
        session?: ClientSession,
    ): Promise<InviteEntity | null> {
        return this.collection().findOneAndUpdate(
            {
                token,
                "activations.userId": { $ne: userId },
                $expr: isActiveExpression(now),
            },
            {
                $push: { activations: { userId, activatedAt: now } },
                $set: { updatedAt: now },
                $inc: { version: 1 },
            },
            { session, returnDocument: "after" },
        );
    }

    revoke(
        _id: ObjectId,
        now: Date,
        session?: ClientSession,
    ): Promise<InviteEntity | null> {
        return this.collection().findOneAndUpdate(
            { _id, revokedAt: { $exists: false } },
            {
                $set: { revokedAt: now, updatedAt: now },
                $inc: { version: 1 },
            },
            { session, returnDocument: "after" },
        );
    }

    async revokeBootstrapInvites(
        now: Date,
        exceptToken?: string,
        session?: ClientSession,
    ): Promise<number> {
        const result = await this.collection().updateMany(
            {
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
            { session },
        );

        return result.modifiedCount;
    }

    async reopen(
        _id: ObjectId,
        now: Date,
        session?: ClientSession,
    ): Promise<void> {
        await this.collection().updateOne(
            { _id },
            {
                $unset: { revokedAt: "" },
                $set: { updatedAt: now },
                $inc: { version: 1 },
            },
            { session },
        );
    }

    findPage(
        { filter, skip, limit, now }: InvitesPageOptions,
        session?: ClientSession,
    ): Promise<InviteEntity[]> {
        return this.collection()
            .aggregate<InviteEntity>(
                [
                    { $match: filter },
                    { $addFields: { isActive: isActiveExpression(now) } },
                    { $sort: { isActive: -1, createdAt: -1, _id: -1 } },
                    { $skip: skip },
                    { $limit: limit },
                    { $project: { isActive: 0 } },
                ],
                { session },
            )
            .toArray();
    }

    count(
        filter: Filter<InviteEntity>,
        session?: ClientSession,
    ): Promise<number> {
        return this.collection().countDocuments(filter, { session });
    }

    private collection() {
        return this.mongo.db.collection<InviteEntity>("invites");
    }
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
        if (!fastify.mongo.db) {
            throw new Error("MongoDB is not connected");
        }

        fastify.decorate(
            "invitesRepository",
            new InvitesRepository(
                fastify.mongo as Required<FastifyMongoObject>,
            ),
        );
    },
    {
        name: "invites-repository",
        dependencies: ["@fastify/mongodb"],
    },
);
