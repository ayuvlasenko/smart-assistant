import { ForbiddenError, subject } from "@casl/ability";
import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { AccessControl, AccessService, adminGrant } from "./access-service.js";

void describe("AccessService", () => {
    void it("gives every ability to a user with the admin grant", async () => {
        const access = buildAccess();
        const admin = buildUserEntity({ grants: [adminGrant] });

        assert.equal(await access.can(admin, "use", "Ping"), true);
        assert.equal(await access.can(admin, "delete", "Invite"), true);
        assert.equal(access.holds(admin, "ping.use"), true);
    });

    void it("gives only the abilities of the user's grants", async () => {
        const access = buildAccess();
        const user = buildUserEntity({ grants: ["ping.use"] });

        assert.equal(await access.can(user, "use", "Ping"), true);
        assert.equal(await access.can(user, "read", "Invite"), false);
        assert.equal(access.holds(user, "ping.use"), true);
        assert.equal(access.holds(user, adminGrant), false);
    });

    void it("adds the default grants to every user without a ban, except admin", async () => {
        const service = new AccessService();
        const access = buildAccess(service);
        const user = buildUserEntity();

        service.useDefaultGrants(() =>
            Promise.resolve(["ping.use", adminGrant]),
        );

        assert.equal(await access.can(user, "use", "Ping"), true);
        assert.equal(await access.can(user, "read", "Invite"), false);
        assert.equal(access.holds(user, "ping.use"), false);
        assert.equal(
            await access.can(
                buildUserEntity({ isBanned: true }),
                "use",
                "Ping",
            ),
            false,
        );
    });

    void it("ignores grants that are not registered", async () => {
        const access = buildAccess();
        const user = buildUserEntity({ grants: ["removed.feature"] });

        assert.equal(await access.can(user, "use", "Ping"), false);
    });

    void it("gives nothing to a banned user", async () => {
        const access = buildAccess();
        const user = buildUserEntity({ isBanned: true, grants: [adminGrant] });

        assert.equal(await access.can(user, "use", "Ping"), false);
        assert.equal(access.holds(user, adminGrant), false);
    });

    void it("throws a forbidden error from assert and allows the same check through a guard", async () => {
        const access = buildAccess();
        const user = buildUserEntity({ grants: ["ping.use"] });
        const canReadInvites = access.guard("read", "Invite");

        await assert.rejects(
            access.assert(user, "read", "Invite"),
            ForbiddenError,
        );
        await access.assert(user, "use", "Ping");
        assert.equal(await canReadInvites(user), false);
        assert.equal(
            await canReadInvites(buildUserEntity({ grants: [adminGrant] })),
            true,
        );
    });

    void it("checks the conditions of a rule against a concrete object", async () => {
        const access = buildAccess();
        const user = buildUserEntity({ grants: ["invites.own"] });

        assert.equal(
            await access.can(
                user,
                "update",
                subject("Invite", {
                    botId: user.botId,
                    createdBy: user._id,
                }),
            ),
            true,
        );
        assert.equal(
            await access.can(
                user,
                "update",
                subject("Invite", {
                    botId: user.botId,
                    createdBy: new ObjectId(),
                }),
            ),
            false,
        );
    });

    void it("limits every rule, also the admin one, to the bot of the user", async () => {
        const access = buildAccess();
        const admin = buildUserEntity({ botId: "42", grants: [adminGrant] });
        const owner = buildUserEntity({ botId: "42", grants: ["invites.own"] });

        assert.equal(await access.can(admin, "read", "Invite"), true);
        assert.equal(
            await access.can(
                admin,
                "update",
                subject("Invite", { botId: "42", createdBy: owner._id }),
            ),
            true,
        );
        assert.equal(
            await access.can(
                admin,
                "update",
                subject("Invite", { botId: "43", createdBy: owner._id }),
            ),
            false,
        );
        assert.equal(
            await access.can(
                owner,
                "update",
                subject("Invite", { botId: "43", createdBy: owner._id }),
            ),
            false,
        );
    });

    void it("reads the default grants of the bot of the user", async () => {
        const service = new AccessService();
        const access = buildAccess(service);

        service.useDefaultGrants((botId) =>
            Promise.resolve(botId === "42" ? ["ping.use"] : []),
        );

        assert.equal(
            await access.can(buildUserEntity({ botId: "42" }), "use", "Ping"),
            true,
        );
        assert.equal(
            await access.can(buildUserEntity({ botId: "43" }), "use", "Ping"),
            false,
        );
    });

    void it("turns the rules of a user into a MongoDB query", async () => {
        const access = buildAccess();
        const owner = buildUserEntity({ grants: ["invites.own"] });
        const admin = buildUserEntity({ grants: [adminGrant] });
        const outsider = buildUserEntity({ grants: ["ping.use"] });

        assert.deepEqual(await access.accessibleBy(admin, "read", "Invite"), {
            $or: [{ botId: admin.botId }],
        });
        assert.deepEqual(await access.accessibleBy(owner, "read", "Invite"), {
            $or: [{ createdBy: owner._id, botId: owner.botId }],
        });
        assert.deepEqual(
            await access.accessibleBy(outsider, "read", "Invite"),
            {
                $expr: { $eq: [0, 1] },
            },
        );
    });

    void it("closes the subjects of a module that the bot of the user does not have, also for an admin", async () => {
        const service = new AccessService();
        const access = buildAccess(service);

        access.register(
            {
                name: "reports",
                title: () => "Reports",
                grants: [
                    {
                        name: "reports.read",
                        title: () => "Read reports",
                        define: ({ can }) => {
                            can("read", "Report");
                        },
                    },
                ],
            },
            { subjects: ["Report"] },
        );
        service.useModules((botId) =>
            Promise.resolve(botId === "42" ? ["reports"] : []),
        );

        const adminOf = (botId: string) =>
            buildUserEntity({ botId, grants: [adminGrant, "reports.read"] });

        assert.equal(await access.can(adminOf("42"), "read", "Report"), true);
        assert.equal(await access.can(adminOf("43"), "read", "Report"), false);
        assert.equal(await access.can(adminOf("43"), "read", "Invite"), true);
        assert.deepEqual(
            await access.accessibleBy(adminOf("43"), "read", "Report"),
            {
                $expr: { $eq: [0, 1] },
            },
        );
        assert.deepEqual(
            await access.listEnabled("43", [
                { name: "reports" },
                { name: "invites" },
            ]),
            [{ name: "invites" }],
        );
        assert.deepEqual(
            access.listModules().map(({ name }) => name),
            ["reports"],
        );
    });

    void it("refuses to register a grant twice", async () => {
        const access = buildAccess();

        assert.throws(() => {
            access.register({
                name: "other",
                title: () => "Other",
                grants: [
                    {
                        name: "ping.use",
                        title: () => "Ping",
                        define: () => undefined,
                    },
                ],
            });
        }, /Access grant "ping.use" is already registered/);
    });

    void it("lists sections in the order of registration", async () => {
        const access = buildAccess();

        assert.deepEqual(
            access.listSections().map(({ name }) => name),
            ["access", "ping", "invites"],
        );
        assert.equal(access.findGrant("ping.use")?.name, "ping.use");
    });
});

interface TestSubjects {
    Invite: { botId: string; createdBy: ObjectId };
    Report: { botId: string };
    Ping: never;
}

function buildAccess(
    service = new AccessService(),
): AccessControl<TestSubjects> {
    const access = service.subjects<TestSubjects>();

    access.register({
        name: "access",
        title: () => "Access",
        grants: [
            {
                name: adminGrant,
                title: () => "Admin",
                define: ({ can }) => {
                    can("manage", "all");
                },
            },
        ],
    });
    access.register({
        name: "ping",
        title: () => "Ping",
        grants: [
            {
                name: "ping.use",
                title: () => "Ping",
                define: ({ can }) => {
                    can("use", "Ping");
                },
            },
        ],
    });
    access.register({
        name: "invites",
        title: () => "Invites",
        grants: [
            {
                name: "invites.own",
                title: () => "Own invites",
                define: ({ can }, user) => {
                    can(["read", "update"], "Invite", { createdBy: user._id });
                },
            },
        ],
    });

    return access;
}
