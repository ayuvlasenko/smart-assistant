import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applySecret,
    buildCommand,
    buildNamespaceCommand,
    ensureNamespaceExists,
    validateSecretName,
    validateValkeyPassword,
} from "./create-server-secret.js";

function withEnv(vars, fn) {
    const previous = new Map();

    for (const [key, value] of Object.entries(vars)) {
        previous.set(key, process.env[key]);
        process.env[key] = value;
    }

    try {
        fn();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

void describe("buildNamespaceCommand", () => {
    void it("builds an idempotent namespace apply command", () => {
        assert.equal(
            buildNamespaceCommand(),
            "kubectl create namespace smart-assistant --dry-run=client -o yaml | kubectl apply -f -",
        );
    });
});

void describe("ensureNamespaceExists", () => {
    void it("applies the namespace manifest when not in dry-run mode", () => {
        const commands = [];
        const messages = [];

        ensureNamespaceExists({
            dryRun: false,
            exec: (command, options) => {
                commands.push({ command, options });
            },
            log: (message) => {
                messages.push(message);
            },
        });

        assert.deepEqual(messages, [
            '\nEnsuring namespace "smart-assistant" exists...\n',
        ]);
        assert.deepEqual(commands, [
            {
                command: buildNamespaceCommand(),
                options: {
                    encoding: "utf-8",
                    shell: "/bin/bash",
                },
            },
        ]);
    });

    void it("skips namespace creation in dry-run mode", () => {
        const commands = [];

        ensureNamespaceExists({
            dryRun: true,
            exec: (command) => {
                commands.push(command);
            },
        });

        assert.deepEqual(commands, []);
    });
});

void describe("validateSecretName", () => {
    void it("throws when secret name is missing", () => {
        assert.throws(() => validateSecretName(""), {
            message: "Secret name is required",
        });
    });

    void it('throws when secret name does not start with "server-secrets-"', () => {
        assert.throws(() => validateSecretName("telegram-secrets-main"), {
            message: "Secret name must start with 'server-secrets-'",
        });
    });

    void it("accepts names with the expected prefix", () => {
        assert.doesNotThrow(() => validateSecretName("server-secrets-main"));
    });
});

void describe("validateValkeyPassword", () => {
    void it("accepts URL-safe passwords", () => {
        assert.doesNotThrow(() => validateValkeyPassword("abcXYZ012._~-"));
    });

    void it("throws when the password contains characters that are unsafe in a URL", () => {
        assert.throws(() => validateValkeyPassword("abc:def"), {
            message:
                "VALKEY_PASSWORD must contain only URL-safe characters: A-Z, a-z, 0-9, '.', '_', '~', '-'",
        });
        assert.throws(() => validateValkeyPassword("abc@def"), {
            message:
                "VALKEY_PASSWORD must contain only URL-safe characters: A-Z, a-z, 0-9, '.', '_', '~', '-'",
        });
        assert.throws(() => validateValkeyPassword("abc/def"), {
            message:
                "VALKEY_PASSWORD must contain only URL-safe characters: A-Z, a-z, 0-9, '.', '_', '~', '-'",
        });
    });
});

void describe("applySecret", () => {
    void it("ensures the namespace only when applying a validated secret", () => {
        const commands = [];
        let secretCommand;

        withEnv(
            {
                DATABASE_URL: "mongodb://localhost:27017/test",
                DOMAIN: "https://smart-assistant.bambom.org",
                LOG_LEVEL: "info",
                S3_ACCESS_KEY_ID: "key",
                S3_SECRET_ACCESS_KEY: "secret",
                S3_REGION: "us-east-1",
                S3_BUCKET: "smart-assistant",
                S3_ENDPOINT: "https://s3.bambom.org",
                TELEGRAM_BOT_TOKEN: "token",
                TELEGRAM_WEBHOOK_SECRET_TOKEN: "secret-token",
                VALKEY_PASSWORD: "valkey-secret",
            },
            () => {
                applySecret({
                    secretName: "server-secrets-main",
                    dryRun: false,
                    exec: (command) => {
                        commands.push(command);
                        return "";
                    },
                    log: () => undefined,
                });

                secretCommand = buildCommand("server-secrets-main", false);
                assert.match(
                    secretCommand,
                    /--from-literal=VALKEY_PASSWORD="valkey-secret"/,
                );
            },
        );

        assert.deepEqual(commands, [buildNamespaceCommand(), secretCommand]);
    });
});
