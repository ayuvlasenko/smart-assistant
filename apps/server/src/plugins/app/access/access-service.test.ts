import { ForbiddenError, subject } from "@casl/ability";
import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { AccessControl, AccessService, adminGrant } from "./access-service.js";

void describe("AccessService", () => {
    void it("gives every ability to a user with the admin grant", () => {
        const access = buildAccess();
        const admin = buildUserEntity({ grants: [adminGrant] });

        assert.equal(access.can(admin, "use", "Ping"), true);
        assert.equal(access.can(admin, "delete", "Invite"), true);
        assert.equal(access.holds(admin, "ping.use"), true);
    });

    void it("gives only the abilities of the user's grants", () => {
        const access = buildAccess();
        const user = buildUserEntity({ grants: ["ping.use"] });

        assert.equal(access.can(user, "use", "Ping"), true);
        assert.equal(access.can(user, "read", "Invite"), false);
        assert.equal(access.holds(user, "ping.use"), true);
        assert.equal(access.holds(user, adminGrant), false);
    });

    void it("ignores grants that are not registered", () => {
        const access = buildAccess();
        const user = buildUserEntity({ grants: ["removed.feature"] });

        assert.equal(access.can(user, "use", "Ping"), false);
    });

    void it("gives nothing to a banned user", () => {
        const access = buildAccess();
        const user = buildUserEntity({ isBanned: true, grants: [adminGrant] });

        assert.equal(access.can(user, "use", "Ping"), false);
        assert.equal(access.holds(user, adminGrant), false);
    });

    void it("throws a forbidden error from assert and allows the same check through a guard", () => {
        const access = buildAccess();
        const user = buildUserEntity({ grants: ["ping.use"] });
        const canReadInvites = access.guard("read", "Invite");

        assert.throws(() => {
            access.assert(user, "read", "Invite");
        }, ForbiddenError);
        assert.doesNotThrow(() => {
            access.assert(user, "use", "Ping");
        });
        assert.equal(canReadInvites(user), false);
        assert.equal(
            canReadInvites(buildUserEntity({ grants: [adminGrant] })),
            true,
        );
    });

    void it("checks the conditions of a rule against a concrete object", () => {
        const access = buildAccess();
        const user = buildUserEntity({ grants: ["invites.own"] });

        assert.equal(
            access.can(
                user,
                "update",
                subject("Invite", { createdBy: user._id }),
            ),
            true,
        );
        assert.equal(
            access.can(
                user,
                "update",
                subject("Invite", { createdBy: new ObjectId() }),
            ),
            false,
        );
    });

    void it("turns the rules of a user into a MongoDB query", () => {
        const access = buildAccess();
        const owner = buildUserEntity({ grants: ["invites.own"] });
        const admin = buildUserEntity({ grants: [adminGrant] });
        const outsider = buildUserEntity({ grants: ["ping.use"] });

        assert.deepEqual(access.accessibleBy(admin, "read", "Invite"), {});
        assert.deepEqual(access.accessibleBy(owner, "read", "Invite"), {
            $or: [{ createdBy: owner._id }],
        });
        assert.deepEqual(access.accessibleBy(outsider, "read", "Invite"), {
            $expr: { $eq: [0, 1] },
        });
    });

    void it("refuses to register a grant twice", () => {
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

    void it("lists sections in the order of registration", () => {
        const access = buildAccess();

        assert.deepEqual(
            access.listSections().map(({ name }) => name),
            ["access", "ping", "invites"],
        );
        assert.equal(access.findGrant("ping.use")?.name, "ping.use");
    });
});

interface TestSubjects {
    Invite: { createdBy: ObjectId };
    Ping: never;
}

function buildAccess(): AccessControl<TestSubjects> {
    const access = new AccessService().subjects<TestSubjects>();

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
