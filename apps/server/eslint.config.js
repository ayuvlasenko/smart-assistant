import typescriptParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import baseConfig from "../../eslint.config.js";

export default defineConfig([
    ...baseConfig,
    {
        files: ["**/*.js", "**/*.ts"],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                project: `${import.meta.dirname}/tsconfig.json`,
                sourceType: "module",
            },
        },
    },
]);
