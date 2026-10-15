import { ForbiddenError } from "@casl/ability";
import { Db, MongoClient, ObjectId } from "mongodb";
import assert from "node:assert/strict";
import {
    after,
    before,
    beforeEach,
    describe,
    it,
    TestContext,
} from "node:test";
import { buildInvitesBot, InvitesBot } from "../../../test/invites-bot.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { adminGrant } from "../access/access-service.js";
import { pingGrant } from "../ping/ping-handlers.js";
import { UserEntity } from "../users/user-entity.js";
import { InviteEntity, InvitesSubjects } from "./invite-entity.js";
import {
    InviteGrantNotAllowedError,
    InviteWithoutGrantsError,
} from "./invites-errors.js";

let databaseName!: string;
let mongoClient!: MongoClient;
let mongo!: Db;

before(async () => {
    const testMongo = await buildTestMongo();

    databaseName = testMongo.databaseName;
    mongoClient = testMongo.client;
    mongo = testMongo.mongo;
});

beforeEach(async () => {
    await mongo.collection("users").deleteMany({});
    await mongo.collection("invites").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

void describe("InvitesService create", () => {
    void it("creates an invite with a link token and unique grants for an admin", async (t) => {
        const bot = await buildBot(t);
        const admin = await createUser(bot, "987654701", [adminGrant]);

        const invite = await bot.invitesService.create(admin, {
            grants: [pingGrant, pingGrant],
            maxUses: 3,
        });

        assert.match(invite.token, /^[A-Za-z0-9_-]{22}$/);
        assert.deepEqual(invite.grants, [pingGrant]);
        assert.equal(invite.maxUses, 3);
        assert.equal(invite.expiresAt, undefined);
        assert.ok(invite.createdBy?.equals(admin._id));
        assert.deepEqual(
            await bot.invitesRepository.findOneById(invite._id),
            invite,
        );
    });

    void it("refuses a user who can't create invites", async (t) => {
        const bot = await buildBot(t);
        const user = await createUser(bot, "987654702", [pingGrant]);

        await assert.rejects(
            bot.invitesService.create(user, { grants: [pingGrant] }),
            ForbiddenError,
        );
    });

    void it("refuses an invite without grants or with an unknown grant", async (t) => {
        const bot = await buildBot(t);
        const admin = await createUser(bot, "987654703", [adminGrant]);

        await assert.rejects(
            bot.invitesService.create(admin, { grants: [] }),
            InviteWithoutGrantsError,
        );
        await assert.rejects(
            bot.invitesService.create(admin, { grants: ["missing.grant"] }),
            InviteGrantNotAllowedError,
        );
    });

    void it("lets an inviter give only the grants the inviter holds", async (t) => {
        const bot = await buildBot(t);

        bot.accessService.subjects<InvitesSubjects>().register({
            name: "test",
            title: () => "Test",
            grants: [
                {
                    name: "test.inviter",
                    title: () => "Inviter",
                    define: ({ can }) => {
                        can("create", "Invite");
                    },
                },
            ],
        });

        const inviter = await createUser(bot, "987654704", ["test.inviter"]);

        await assert.rejects(
            bot.invitesService.create(inviter, { grants: [pingGrant] }),
            new InviteGrantNotAllowedError(pingGrant),
        );
        assert.deepEqual(
            (
                await bot.invitesService.create(inviter, {
                    grants: ["test.inviter"],
                })
            ).grants,
            ["test.inviter"],
        );
    });
});

void describe("InvitesService activate", () => {
    void it("gives the grants of the invite to a banned user and lifts the ban", async (t) => {
        const bot = await buildBot(t);
        const invite = await createInvite(bot, { grants: [pingGrant] });
        const user = await createUser(bot, "987654711", [], true);

        const result = await bot.invitesService.activate(user, invite.token);

        assert.equal(result.status, "activated");
        assert.ok("user" in result);
        assert.equal(result.user.isBanned, false);
        assert.deepEqual(result.user.grants, [pingGrant]);
        assert.deepEqual(
            (
                await bot.invitesRepository.findOneById(invite._id)
            )?.activations.map(({ userId }) => userId.toHexString()),
            [user._id.toHexString()],
        );
    });

    void it("adds the grants of the invite to the grants of an existing user", async (t) => {
        const bot = await buildBot(t);
        const invite = await createInvite(bot, { grants: [pingGrant] });
        const user = await createUser(bot, "987654712", ["other.grant"]);

        const result = await bot.invitesService.activate(user, invite.token);

        assert.ok("user" in result);
        assert.deepEqual(result.user.grants, ["other.grant", pingGrant]);
    });

    void it("counts a repeated activation once and gives the grants again", async (t) => {
        const bot = await buildBot(t);
        const invite = await createInvite(bot, { grants: [pingGrant] });
        const user = await createUser(bot, "987654713", [], true);

        await bot.invitesService.activate(user, invite.token);
        await mongo
            .collection("users")
            .updateOne({ _id: user._id }, { $set: { grants: [] } });

        const result = await bot.invitesService.activate(user, invite.token);

        assert.equal(result.status, "alreadyActivated");
        assert.ok("user" in result);
        assert.deepEqual(result.user.grants, [pingGrant]);
        assert.equal(
            (await bot.invitesRepository.findOneById(invite._id))?.activations
                .length,
            1,
        );
    });

    void it("doesn't give the grants again from a revoked or expired invite", async (t) => {
        const bot = await buildBot(t);
        const revoked = await createInvite(bot, { grants: [pingGrant] });
        const expired = await createInvite(bot, { grants: [pingGrant] });
        const user = await createUser(bot, "987654716", [], true);

        await bot.invitesService.activate(user, revoked.token);
        await bot.invitesService.activate(user, expired.token);
        await bot.invitesRepository.revoke(revoked._id, new Date());
        await mongo
            .collection("invites")
            .updateOne(
                { _id: expired._id },
                { $set: { expiresAt: new Date(Date.now() - 1000) } },
            );
        await mongo
            .collection("users")
            .updateOne(
                { _id: user._id },
                { $set: { isBanned: true, grants: [] } },
            );

        assert.deepEqual(
            [
                (await bot.invitesService.activate(user, revoked.token)).status,
                (await bot.invitesService.activate(user, expired.token)).status,
            ],
            ["revoked", "expired"],
        );

        const stored = await bot.usersRepository.findOneById(user._id);

        assert.equal(stored?.isBanned, true);
        assert.deepEqual(stored.grants, []);
    });

    void it("names the reason when the invite can't be used", async (t) => {
        const bot = await buildBot(t);
        const user = await createUser(bot, "987654714", [], true);
        const other = await createUser(bot, "987654715", [], true);
        const expired = await createInvite(bot, {
            grants: [pingGrant],
            expiresAt: new Date(Date.now() - 1000),
        });
        const revoked = await createInvite(bot, { grants: [pingGrant] });
        const full = await createInvite(bot, {
            grants: [pingGrant],
            maxUses: 1,
        });

        await bot.invitesRepository.revoke(revoked._id, new Date());
        await bot.invitesService.activate(other, full.token);

        assert.deepEqual(
            await Promise.all(
                ["missing-token", expired.token, revoked.token, full.token].map(
                    async (token) =>
                        (await bot.invitesService.activate(user, token)).status,
                ),
            ),
            ["notFound", "expired", "revoked", "full"],
        );
        assert.equal(
            (await bot.usersRepository.findOneById(user._id))?.isBanned,
            true,
        );
    });

    void it("lets only as many users in at the same time as the limit allows", async (t) => {
        const bot = await buildBot(t);
        const invite = await createInvite(bot, {
            grants: [pingGrant],
            maxUses: 2,
        });
        const users = await Promise.all(
            [1, 2, 3, 4, 5, 6].map((index) =>
                createUser(bot, `98765472${index}`, [], true),
            ),
        );

        const results = await Promise.all(
            users.map((user) =>
                bot.invitesService.activate(user, invite.token),
            ),
        );

        assert.deepEqual(
            results
                .map(({ status }) => status)
                .sort((left, right) => left.localeCompare(right)),
            ["activated", "activated", "full", "full", "full", "full"],
        );
        assert.equal(
            (await bot.invitesRepository.findOneById(invite._id))?.activations
                .length,
            2,
        );
    });
});

void describe("InvitesService access to single invites", () => {
    void it("lets a user with a conditional grant see and revoke only own invites", async (t) => {
        const bot = await buildBot(t);

        bot.accessService.subjects<InvitesSubjects>().register({
            name: "test",
            title: () => "Test",
            grants: [
                {
                    name: "test.ownInvites",
                    title: () => "Own invites",
                    define: ({ can }, user) => {
                        can(["create", "read", "update"], "Invite", {
                            createdBy: user._id,
                        });
                    },
                },
            ],
        });

        const first = await createUser(bot, "987654751", [
            "test.ownInvites",
            pingGrant,
        ]);
        const second = await createUser(bot, "987654752", [
            "test.ownInvites",
            pingGrant,
        ]);
        const own = await bot.invitesService.create(first, {
            grants: [pingGrant],
        });
        const foreign = await bot.invitesService.create(second, {
            grants: [pingGrant],
        });
        const page = await bot.invitesService.list(first, {
            skip: 0,
            limit: 5,
        });

        assert.equal(page.total, 1);
        assert.deepEqual(
            page.items.map(({ _id }) => _id.toHexString()),
            [own._id.toHexString()],
        );
        assert.equal(
            (await bot.invitesService.find(first, own._id))?.token,
            own.token,
        );
        assert.equal(await bot.invitesService.find(first, foreign._id), null);
        await assert.rejects(
            bot.invitesService.revoke(first, foreign._id),
            ForbiddenError,
        );
        await assert.rejects(
            bot.invitesService.listUsers(first, foreign, { skip: 0, limit: 5 }),
            ForbiddenError,
        );
        assert.equal(
            (await bot.invitesRepository.findOneById(foreign._id))?.revokedAt,
            undefined,
        );
        assert.ok((await bot.invitesService.revoke(first, own._id))?.revokedAt);
    });
});

void describe("InvitesService lists", () => {
    void it("lists active invites first and the newest first inside each group", async (t) => {
        const bot = await buildBot(t);
        const admin = await createUser(bot, "987654731", [adminGrant]);
        const older = await createInvite(bot, { grants: [pingGrant] });
        const revoked = await createInvite(bot, { grants: [pingGrant] });
        const newer = await createInvite(bot, { grants: [pingGrant] });

        await bot.invitesRepository.revoke(revoked._id, new Date());

        const page = await bot.invitesService.list(admin, {
            skip: 0,
            limit: 2,
        });

        assert.equal(page.total, 3);
        assert.deepEqual(
            page.items.map(({ _id }) => _id.toHexString()),
            [newer._id, older._id].map((id) => id.toHexString()),
        );
    });

    void it("lists the users of an invite from the latest activation", async (t) => {
        const bot = await buildBot(t);
        const admin = await createUser(bot, "987654732", [adminGrant]);
        const invite = await createInvite(bot, { grants: [pingGrant] });
        const first = await createUser(bot, "987654733", [], true);
        const second = await createUser(bot, "987654734", [], true);

        await bot.invitesService.activate(first, invite.token);
        await bot.invitesService.activate(second, invite.token);

        const activated = await bot.invitesRepository.findOneById(invite._id);

        assert.ok(activated);

        const page = await bot.invitesService.listUsers(admin, activated, {
            skip: 0,
            limit: 1,
        });

        assert.equal(page.total, 2);
        assert.deepEqual(
            page.items.map(({ user }) => user?.telegramId),
            ["987654734"],
        );
    });

    void it("shows no invites to a user without access", async (t) => {
        const bot = await buildBot(t);
        const user = await createUser(bot, "987654735", [pingGrant]);
        const invite = await createInvite(bot, { grants: [pingGrant] });

        assert.deepEqual(
            await bot.invitesService.list(user, { skip: 0, limit: 5 }),
            { items: [], total: 0 },
        );
        assert.equal(await bot.invitesService.find(user, invite._id), null);
    });
});

void describe("InvitesService bootstrap", () => {
    void it("creates a single-use admin invite from INVITE_TOKEN while there is no admin", async (t) => {
        const bot = await buildBot(t, { INVITE_TOKEN: "bootstrap-token" });
        const invite =
            await bot.invitesRepository.findOneByToken("bootstrap-token");

        assert.deepEqual(invite?.grants, [adminGrant]);
        assert.equal(invite.maxUses, 1);
        assert.deepEqual(
            await bot.invitesService.bootstrap("bootstrap-token"),
            {
                invite: "kept",
                revoked: 0,
            },
        );
    });

    void it("revokes the invite of the old token when the token changes", async (t) => {
        const bot = await buildBot(t);
        const holder = await createUser(bot, "987654742", [], true);

        await bot.invitesService.bootstrap("token-a");

        assert.deepEqual(await bot.invitesService.bootstrap("token-b"), {
            invite: "created",
            revoked: 1,
        });
        assert.equal(
            (await bot.invitesService.activate(holder, "token-a")).status,
            "revoked",
        );
        assert.equal(
            (await bot.invitesService.activate(holder, "token-b")).status,
            "activated",
        );
    });

    void it("reopens the unused invite of a token that comes back", async (t) => {
        const bot = await buildBot(t);
        const holder = await createUser(bot, "987654744", [], true);

        await bot.invitesService.bootstrap("token-a");
        await bot.invitesService.bootstrap(undefined);

        assert.deepEqual(await bot.invitesService.bootstrap("token-a"), {
            invite: "reopened",
            revoked: 0,
        });
        assert.equal(
            (await bot.invitesService.activate(holder, "token-a")).status,
            "activated",
        );
    });

    void it("reports a used token as unusable instead of making a second admin", async (t) => {
        const bot = await buildBot(t);
        const holder = await createUser(bot, "987654745", [], true);
        const other = await createUser(bot, "987654746", [], true);

        await bot.invitesService.bootstrap("token-a");
        await bot.invitesService.activate(holder, "token-a");
        await mongo
            .collection("users")
            .updateOne({ _id: holder._id }, { $set: { grants: [] } });

        assert.deepEqual(await bot.invitesService.bootstrap("token-a"), {
            invite: "unusable",
            revoked: 0,
        });
        assert.equal(
            (await bot.invitesService.activate(other, "token-a")).status,
            "full",
        );
    });

    void it("keeps a used and revoked invite closed when its token comes back", async (t) => {
        const bot = await buildBot(t);
        const holder = await createUser(bot, "987654747", [], true);
        const other = await createUser(bot, "987654748", [], true);

        await bot.invitesService.bootstrap("token-a");
        await bot.invitesService.activate(holder, "token-a");
        await bot.invitesService.bootstrap("token-a");
        await mongo
            .collection("users")
            .updateOne({ _id: holder._id }, { $set: { grants: [] } });

        assert.deepEqual(await bot.invitesService.bootstrap("token-a"), {
            invite: "unusable",
            revoked: 0,
        });
        assert.equal(
            (await bot.invitesService.activate(other, "token-a")).status,
            "revoked",
        );
    });

    void it("revokes every bootstrap invite once an admin exists or the token is gone, and keeps the invites of admins", async (t) => {
        const bot = await buildBot(t);
        const admin = await createUser(bot, "987654743", [adminGrant]);

        await mongo.collection("invites").insertOne({
            token: "orphan-token",
            grants: [adminGrant],
            maxUses: 1,
            activations: [],
            version: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const adminInvite = await bot.invitesService.create(admin, {
            grants: [pingGrant],
        });

        assert.deepEqual(await bot.invitesService.bootstrap("orphan-token"), {
            invite: "none",
            revoked: 1,
        });
        assert.ok(
            (await bot.invitesRepository.findOneByToken("orphan-token"))
                ?.revokedAt,
        );
        assert.equal(
            (await bot.invitesRepository.findOneById(adminInvite._id))
                ?.revokedAt,
            undefined,
        );

        await mongo.collection("users").deleteMany({});
        await bot.invitesService.bootstrap("fresh-token");

        assert.deepEqual(await bot.invitesService.bootstrap(undefined), {
            invite: "none",
            revoked: 1,
        });
        assert.ok(
            (await bot.invitesRepository.findOneByToken("fresh-token"))
                ?.revokedAt,
        );
    });
});

function buildBot(
    t: TestContext,
    env: Record<string, string> = {},
): Promise<InvitesBot> {
    return buildInvitesBot({ databaseName, mongoClient, t, env });
}

async function createUser(
    bot: InvitesBot,
    telegramId: string,
    grants: string[],
    isBanned = false,
): Promise<UserEntity> {
    const user = await bot.usersRepository.findOneByTelegramIdOrCreate({
        telegramId,
        isBanned,
        languageCode: "en",
    });

    if (!grants.length) {
        return user;
    }

    await mongo
        .collection("users")
        .updateOne({ _id: user._id }, { $set: { grants } });

    return { ...user, grants };
}

function createInvite(
    bot: InvitesBot,
    data: Pick<InviteEntity, "grants"> &
        Partial<Pick<InviteEntity, "maxUses" | "expiresAt">>,
): Promise<InviteEntity> {
    return bot.invitesRepository.create({
        token: new ObjectId().toHexString(),
        ...data,
    });
}
