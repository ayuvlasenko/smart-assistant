import typescriptParser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import { after, describe, it } from "node:test";
import fileLayout from "./file-layout.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = after;

const ruleTester = new RuleTester({
    languageOptions: { parser: typescriptParser, sourceType: "module" },
});

ruleTester.run("file-layout", fileLayout, {
    valid: [
        {
            filename: "src/plugins/app/users/users-service.ts",
            code: `
                import fp from "fastify-plugin";
                interface Options { size: number }
                const limit = 10;
                export class UsersService { run(): number { return readLimit(); } }
                function readLimit(): number { return limit; }
                export default fp(async () => undefined);
            `,
        },
        {
            filename: "src/plugins/external/kv-valkey.ts",
            code: `
                import fp from "fastify-plugin";
                export default fp(async () => buildClient());
                function buildClient(): number { return 1; }
            `,
        },
    ],
    invalid: [
        {
            filename: "src/plugins/app/users/users-service.ts",
            code: `
                export class UsersService {}
                import fp from "fastify-plugin";
                const limit = 10;
                interface Options { size: number }
                export default fp(async () => undefined);
                declare module "fastify" { interface FastifyInstance { users: number } }
            `,
            errors: [
                { messageId: "importAfterCode" },
                { messageId: "declarationAfterMain" },
                { messageId: "declarationAfterMain" },
                { messageId: "defaultNotLast" },
                { messageId: "declarationAfterMain" },
            ],
        },
        {
            filename: "src/plugins/app/users/users-service.ts",
            code: `
                function readLimit(): number { return 1; }
                export function run(): number { return readLimit(); }
            `,
            errors: [{ messageId: "helperAboveCaller" }],
        },
        {
            filename: "src/utils/parsers.ts",
            code: "export const answer = 42;",
            errors: [{ messageId: "codeKindFile" }],
        },
        {
            filename: "src/types/utility.ts",
            code: "export type Answer = number;",
            errors: [{ messageId: "codeKindFile" }],
        },
        {
            filename: "src/plugins/app/users/users-types.ts",
            code: "export const answer = 42;",
            errors: [{ messageId: "codeKindFile" }],
        },
    ],
});
