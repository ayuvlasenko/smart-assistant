#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path */
/* eslint-disable sonarjs/os-command */

import { execSync } from "node:child_process";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const NAMESPACE = "smart-assistant";

const valkeyPasswordPattern = /^[A-Za-z0-9._~-]+$/;

const REQUIRED_ENV_VARS = [
    "DATABASE_URL",
    "DOMAIN",
    "LOG_LEVEL",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ENDPOINT",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET_TOKEN",
    "VALKEY_PASSWORD",
];

const OPTIONAL_ENV_VARS = ["TELEGRAM_WEBHOOK_URL"];

function validateEnvVars() {
    const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
    if (missing.length > 0) {
        console.error("Missing required environment variables:");
        missing.forEach((v) => console.error(`  - ${v}`));
        console.error("\nSet them before running this script:");
        console.error("  # bash/zsh");
        console.error(
            `  export ${missing[0]}="value" && node scripts/create-server-secret.js`,
        );
        console.error("  # fish");
        console.error(
            `  set -x ${missing[0]} "value"; and node scripts/create-server-secret.js`,
        );
        process.exit(1);
    }

    validateValkeyPassword(process.env.VALKEY_PASSWORD);
}

export function buildCommand(secretName, dryRun) {
    const envVars = [
        ...REQUIRED_ENV_VARS,
        ...OPTIONAL_ENV_VARS.filter((v) => process.env[v]),
    ];
    const literals = envVars
        .map((v) => `--from-literal=${v}="${process.env[v]}"`)
        .join(" \\\n          ");

    if (dryRun) {
        return `kubectl create secret generic ${secretName} -n ${NAMESPACE} \\\n          ${literals} --dry-run=client -o yaml`;
    }

    return `kubectl create secret generic ${secretName} -n ${NAMESPACE} \\\n          ${literals} --dry-run=client -o yaml | kubectl apply -f -`;
}

export function buildNamespaceCommand() {
    return `kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`;
}

export function ensureNamespaceExists({
    dryRun,
    exec = execSync,
    log = console.log,
} = {}) {
    if (dryRun) {
        return;
    }

    log(`\nEnsuring namespace "${NAMESPACE}" exists...\n`);
    exec(buildNamespaceCommand(), {
        encoding: "utf-8",
        shell: "/bin/bash",
    });
}

export function validateSecretName(secretName) {
    if (!secretName) {
        throw new Error("Secret name is required");
    }

    if (!secretName.startsWith("server-secrets-")) {
        throw new Error("Secret name must start with 'server-secrets-'");
    }
}

export function validateValkeyPassword(password) {
    if (typeof password !== "string" || !valkeyPasswordPattern.test(password)) {
        throw new Error(
            "VALKEY_PASSWORD must contain only URL-safe characters: A-Z, a-z, 0-9, '.', '_', '~', '-'",
        );
    }
}

export function applySecret({
    secretName,
    dryRun,
    exec = execSync,
    log = console.log,
}) {
    ensureNamespaceExists({ dryRun, exec, log });

    const command = buildCommand(secretName, dryRun);

    if (dryRun) {
        log("\nDry run - would execute:\n");
        log(command);
        log("\n--- Generated YAML ---\n");
    } else {
        log(
            `\nApplying secret "${secretName}" in namespace "${NAMESPACE}"...\n`,
        );
    }

    const output = exec(command, {
        encoding: "utf-8",
        shell: "/bin/bash",
    });
    log(output);

    if (!dryRun) {
        log("Secret created/updated successfully!");
    }
}

function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function getBranchSlug() {
    try {
        const branch = execSync("git branch --show-current", {
            encoding: "utf-8",
        }).trim();
        return branch.replace(/\//g, "-").toLowerCase();
    } catch {
        return null;
    }
}

function getPrNumber() {
    try {
        const result = execSync("gh pr view --json number -q .number", {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        return result || null;
    } catch {
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");

    validateEnvVars();

    const branchSlug = getBranchSlug();
    const prNumber = getPrNumber();

    console.log("Create Kubernetes secret for smart-assistant server\n");

    try {
        const existing = execSync(
            `kubectl get secrets -n ${NAMESPACE} -o name`,
            { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        )
            .trim()
            .split("\n")
            .filter((s) => s.includes("server-secrets-"))
            .map((s) => s.replace("secret/", ""));

        if (existing.length > 0) {
            console.log("Existing secrets:");
            existing.forEach((s) => console.log(`  - ${s}`));
        } else {
            console.log("No existing server secrets found.");
        }
    } catch {
        console.log(
            "Could not fetch existing secrets (kubectl not available?).",
        );
    }

    console.log("\nExamples:");
    console.log("  - server-secrets-base (shared by all deployments)");
    if (branchSlug) {
        console.log(`  - server-secrets-${branchSlug} (current branch)`);
    } else {
        console.log("  - server-secrets-<branch> (branch specific)");
    }
    if (prNumber) {
        console.log(`  - server-secrets-pr-${prNumber} (current PR)`);
    } else {
        console.log(
            "  - server-secrets-pr-<number> (PR specific, no PR detected)",
        );
    }
    console.log();

    const secretName = await prompt("Secret name: ");

    try {
        validateSecretName(secretName);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    try {
        applySecret({
            secretName,
            dryRun,
        });
    } catch (error) {
        console.error("Failed to apply secret:", error.message);
        process.exit(1);
    }
}

if (process.argv[1]) {
    const isMainModule =
        import.meta.url === pathToFileURL(process.argv[1]).href;

    if (isMainModule) {
        main();
    }
}
