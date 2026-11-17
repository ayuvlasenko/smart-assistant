import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

Object.assign(
    process.env,
    parseEnv(readFileSync(new URL("../../.env.test", import.meta.url), "utf8")),
);
