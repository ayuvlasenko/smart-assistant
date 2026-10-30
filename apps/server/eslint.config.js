import typescriptParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import baseConfig from "../../eslint.config.js";
import fileLayout from "./eslint-rules/file-layout.js";

export default defineConfig([
    ...baseConfig,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                project: `${import.meta.dirname}/tsconfig.json`,
                sourceType: "module",
            },
        },
    },
    {
        files: ["src/**/*.ts"],
        ignores: ["src/**/*.test.ts", "src/test/**", "src/server.ts"],
        plugins: {
            local: { rules: { "file-layout": fileLayout } },
        },
        rules: {
            "local/file-layout": "warn",
            "max-lines": ["warn", { max: 400, skipComments: true }],
        },
    },
    {
        files: ["src/plugins/app/telegram/telegram-scene-engine.ts"],
        rules: {
            "max-lines": ["warn", { max: 640, skipComments: true }],
        },
    },
    {
        files: ["src/plugins/app/telegram/telegram-scene-inputs.ts"],
        rules: {
            "max-lines": ["warn", { max: 510, skipComments: true }],
        },
    },
]);
