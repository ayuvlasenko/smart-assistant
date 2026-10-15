import { ForbiddenError, subject } from "@casl/ability";
import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { AccessService, adminGrant } from "./access-service.js";

void describe("AccessService", () => {
    void it("gives every ability to a user with the admin grant", () => {
        const accessService = buildAccessService();
        const admin = buildUserEntity({ grants: [adminGrant] });

        assert.equal(accessService.can(admin, "use", "Ping"), true);
        assert.equal(accessService.can(admin, "delete", "Invite"), true);
        assert.equal(accessService.holds(admin, "ping.use"), true);
    });

    void it("gives only the abilities of the user's grants", () => {
        const accessService = buildAccessService();
        const user = buildUserEntity({ grants: ["ping.use"] });

        assert.equal(accessService.can(user, "use", "Ping"), true);
        assert.equal(accessService.can(user, "read", "Invite"), false);
        assert.equal(accessService.holds(user, "ping.use"), true);
        assert.equal(accessService.holds(user, adminGrant), false);
    });

    void it("ignores grants that are not registered", () => {
        const accessService = buildAccessService();
        const user = buildUserEntity({ grants: ["removed.feature"] });

        assert.equal(accessService.can(user, "use", "Ping"), false);
    });

    void it("gives nothing to a banned user", () => {
        const accessService = buildAccessService();
        const user = buildUserEntity({ isBanned: true, grants: [adminGrant] });

        assert.equal(accessService.can(user, "use", "Ping"), false);
        assert.equal(accessService.holds(user, adminGrant), false);
    });

    void it("throws a forbidden error from assert and allows the same check through a guard", () => {
        const accessService = buildAccessService();
        const user = buildUserEntity({ grants: ["ping.use"] });
        const canReadInvites = accessService.guard("read", "Invite");

        assert.throws(() => {
            accessService.assert(user, "read", "Invite");
        }, ForbiddenError);
        assert.doesNotThrow(() => {
            accessService.assert(user, "use", "Ping");
        });
        assert.equal(canReadInvites(user), false);
        assert.equal(
            canReadInvites(buildUserEntity({ grants: [adminGrant] })),
            true,
        );
    });

    void it("checks the conditions of a rule against a concrete object", () => {
        const accessService = buildAccessService();
        const user = buildUserEntity({ grants: ["invites.own"] });

        assert.equal(
            accessService.can(
                user,
                "update",
                subject("Invite", { createdBy: user._id }),
            ),
            true,
        );
        assert.equal(
            accessService.can(
                user,
                "update",
                subject("Invite", { createdBy: new ObjectId() }),
            ),
            false,
        );
    });

    void it("turns the rules of a user into a MongoDB query", () => {
        const accessService = buildAccessService();
        const owner = buildUserEntity({ grants: ["invites.own"] });
        const admin = buildUserEntity({ grants: [adminGrant] });
        const outsider = buildUserEntity({ grants: ["ping.use"] });

        assert.deepEqual(
            accessService.accessibleBy(admin, "read", "Invite"),
            {},
        );
        assert.deepEqual(accessService.accessibleBy(owner, "read", "Invite"), {
            $or: [{ createdBy: owner._id }],
        });
        assert.deepEqual(
            accessService.accessibleBy(outsider, "read", "Invite"),
            { $expr: { $eq: [0, 1] } },
        );
    });

    void it("refuses to register a grant twice", () => {
        const accessService = buildAccessService();

        assert.throws(() => {
            accessService.register({
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
        const accessService = buildAccessService();

        assert.deepEqual(
            accessService.listSections().map(({ name }) => name),
            ["access", "ping", "invites"],
        );
        assert.equal(accessService.findGrant("ping.use")?.name, "ping.use");
    });
});

function buildAccessService(): AccessService {
    const accessService = new AccessService();

    accessService.register({
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
    accessService.register({
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
    accessService.register({
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

    return accessService;
}
