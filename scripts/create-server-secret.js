#!/usr/bin/env node

import { execSync } from "node:child_process";
import readline from "node:readline";

const NAMESPACE = "smart-assistant";

const REQUIRED_ENV_VARS = [
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "DOMAIN",
    "LOG_LEVEL",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ENDPOINT",
];

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
}

function buildCommand(secretName, dryRun) {
    const literals = REQUIRED_ENV_VARS.map(
        (v) => `--from-literal=${v}="${process.env[v]}"`,
    ).join(" \\\n          ");

    if (dryRun) {
        return `kubectl create secret generic ${secretName} -n ${NAMESPACE} \\\n          ${literals} --dry-run=client -o yaml`;
    }

    return `kubectl create secret generic ${secretName} -n ${NAMESPACE} \\\n          ${literals} --dry-run=client -o yaml | kubectl apply -f -`;
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

    if (!secretName) {
        console.error("Secret name is required");
        process.exit(1);
    }

    if (!secretName.startsWith("server-secrets-")) {
        console.error('Secret name must start with "server-secrets-"');
        process.exit(1);
    }

    const command = buildCommand(secretName, dryRun);

    if (dryRun) {
        console.log("\nDry run - would execute:\n");
        console.log(command);
        console.log("\n--- Generated YAML ---\n");
    } else {
        console.log(
            `\nApplying secret "${secretName}" in namespace "${NAMESPACE}"...\n`,
        );
    }

    try {
        const output = execSync(command, {
            encoding: "utf-8",
            shell: "/bin/bash",
        });
        console.log(output);
        if (!dryRun) {
            console.log("Secret created/updated successfully!");
        }
    } catch (error) {
        console.error("Failed to apply secret:", error.message);
        process.exit(1);
    }
}

main();
