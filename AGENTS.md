# AGENTS.md

Smart Assistant is a Telegram bot with permissions and invites. The server is in `apps/server/`: Fastify 5, MongoDB with the plain driver, TypeBox for schemas, Valkey for sessions and locks.

## Commands

Run all commands from the project root:

```bash
pnpm --filter server dev        # Build TypeScript and start server with hot reload
pnpm --filter server build      # Compile TypeScript only
pnpm --filter server typecheck  # Run full TypeScript checks, including tests and fixtures
pnpm test                       # Run all tests: root scripts and every workspace
pnpm --filter server test       # Run server tests
pnpm lint                       # Run every check of CI: Markdown, Prettier and ESLint
pnpm --filter server lint       # Run ESLint for backend
pnpm format                     # Format Markdown, root scripts and all workspaces
pnpm --filter server format     # Run ESLint fix + Prettier for backend
pnpm --filter <workspace> add <package>
```

Run a single test file:

```bash
pnpm --filter server exec node --env-file=.env.test --import tsx --test src/path/to/file.test.ts
```

Manage MongoDB migrations with `pnpm --filter server migrate:create|migrate:up|migrate:down|migrate:status`. `lockTtl` in `apps/server/migrate-mongo-config.js` equals `migration.activeDeadlineSeconds` in `deploy/migration/values.yaml`, 300 s: change both together, or a slow migration loses its lock while it still runs.

Before a commit, run `pnpm format`, then `pnpm --filter server typecheck`, `pnpm lint` and `pnpm test`; CI runs the same three checks. Lint does not replace typecheck: `build` excludes tests and `src/test/`.

Write commit messages in English as Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.

After the first push of a pull request, wait for the CI `deploy` job with `gh pr checks <number> --watch`, then run `curl -fsS -X POST https://pr-<number>.smart-assistant.bambom.org/api/telegram/webhook/refresh`. CI skips a draft pull request, so its preview appears only after the pull request is marked ready for review. Preview pods share one bot token, so the bot answers only the preview whose webhook was refreshed last. A later push redeploys the same preview and keeps its webhook; refresh again only when another preview took the bot.

## Documentation

- `apps/server/src/plugins/app/telegram/README.md`: how to write commands, deep links and scenes, the Bot UX rules, and how the transport and the scene engine work. Read it before you write or change bot code.
- `apps/server/src/plugins/app/access/README.md`: the permission model and how to add a permission to a domain.
- `apps/server/src/plugins/app/invites/README.md`: invites, their activation and the bootstrap of the first admin.
- `apps/server/src/plugins/app/poker/README.md`: planning poker rooms, their conditional updates, idle participants and the round summary.
- `apps/server/src/plugins/app/settings/README.md`: settings that an admin changes in `/settings`, how a domain registers one and how the pods read it.
- `docs/backlog/`: known problems that are not being fixed now, one file per item.

Keep a README in line with the code you change. A README explains how a mechanism works and why; this file keeps only the rules. Follow the `write-docs` skill in `.agents/skills/` when you write or restructure documentation; `.claude/skills` links to the same folder.

## Architecture

- The Telegram bot uses `@grammyjs/types` for types and plain `fetch` for Bot API calls. Do not add a bot framework or any other Telegram library; the update routing and scenes are implemented in the project.
- The bot works in private chats only. Do not add group-specific behavior such as reply targets or forum topics.
- Fastify autoload loads directories in order: `plugins/external/` (third-party plugin wrappers), then `plugins/app/` (services and repositories), then `routes/` (HTTP routes with `autoHooks` and `cascadeHooks`).
- Services are classes registered as Fastify decorators through `fastify-plugin` with explicit `dependencies`. Read them with `fastify.getDecorator<T>()`, and read the config with `fastify.getDecorator<Env>("config")`. Use module augmentation only for third-party plugin types, never for app-owned decorators.
- A route file matches its parent directory name, such as `telegram/telegram.ts` for the prefix `/api/telegram`.

### Project structure

- Each domain lives in `plugins/app/<domain>/` with its services, repositories, entities, schemas, scenes, steps and tests. Keep exactly one level: no subdirectories inside a domain and no `index.ts`.
- A service or repository file exports its class and registers it as a plugin with `export default fp(...)`. Only plugin files use `export default`; every other file uses named exports, because autoload loads any default-exported plugin.
- `plugins/app/telegram/` holds the Telegram transport and the scene engine. It does not import feature domains; a domain registers its own scenes and commands through the Telegram router.
- Shared infrastructure (`cache-service.ts`, `lock-service.ts` with `lock-errors.ts`, `rate-limiter.ts` with `rate-limit-queue.ts`, `app-logger.ts`, `metrics-service.ts` with `http-metrics.ts` and `mongo-metrics.ts`, `unhandled-rejection-reporter.ts`) stays at the top level of `plugins/app/`. `routes/` holds HTTP routes only.
- The env schema and its `Env` type stay in `src/env.ts`. Any other schema stays in the single file that uses it, or in `<domain>-schemas.ts` when several files of a domain use it.

### Files

- Name a file and a directory in kebab case, after the main export of the file, with the domain prefix, so every file name is unique: `users-repository.ts` (`UsersRepository`), `user-entity.ts`, `create-account-scene.ts` (`createAccountScene`), `choose-account-step.ts`. A test is `<file>.test.ts` next to the file.
- A file holds one abstraction: its main export, the types of its own public API, and private helpers. A type, schema, constant or function that describes another abstraction's data lives in that abstraction's file.
- Split a file by abstraction, never by kind of code: no `*-types.ts`, `*-constants.ts`, `*-utils.ts`, and no `utils/` or `types/` folder. Only `<domain>-errors.ts`, `<domain>-events.ts` (one interface that maps every event name of the domain to its payload), `<domain>-schemas.ts` and `<domain>-locales.ts` collect one kind of code for a domain. Keep small functions of one topic together in one file, such as the parsers of typed input.
- Order a file: imports; the types, schemas, constants and `declare module` augmentations; the main export; private helpers in the order of their first use. A file that exports a class ends with `export default fp(...)`. `telegram-router.ts` is the reference.
- A source file over about 400 lines holds a second abstraction: move it to its own file. `pnpm --filter server lint` warns about the layout rules through `max-lines` and `local/file-layout` in `apps/server/eslint-rules/`. Fix a warning in the code you touch.
- Throw a class from `<domain>-errors.ts` when code catches the error by type or reads its fields, such as `TelegramApiError`. Throw a plain `Error` for a bug or a wrong configuration that only stops the start or the update.

### Bot code

Read `plugins/app/telegram/README.md` before you write bot code. These rules break the bot silently when you miss them:

- Build every interaction that keeps state between updates as a scene. Keep business data in its domain repository; a scene keeps only the user's view of it, such as an id or a page.
- Call the domain and check the data before you change `scene.state`: a failed handler keeps the changes it made before the error.
- Create every inline button with `scene.button`, `scene.screenButton`, `scene.backButton` or `input.button`. Never write `callback_data` by hand.
- Lay out every keyboard by [Button layout](apps/server/src/plugins/app/telegram/README.md#button-layout): navigation row last with `‹ Back` on the left, at most two buttons in a row, values in the text and not on the buttons.
- Show every message of a scene through a screen in `screens`, and move between screens with `scene.push`, `replace`, `back` and `reset`. Keep the fields of one screen, such as an id or a page, in its params; `scene.state` keeps only what outlives a screen, such as a draft. Never keep a message id or the current screen in the state. See [Screens and messages](apps/server/src/plugins/app/telegram/README.md#screens-and-messages).
- Ask for a destructive action with `confirm: true` on its button. Never build the two presses with a flag in the state: the engine cancels a pending confirmation on every other press and move.
- Check the `false` that `sceneEngine.start` and `scene.handOver` return: a blocking scene refuses other scenes.
- Never write to the session of another user. Emit a domain event and call `telegramChats.publish` or `telegramChats.deliver`.
- Build a deep link URL with `telegramBotService.resolveDeepLinkUrl`, never by hand.
- When you add a Bot API method that sends, edits or deletes a message, add it to `telegramRateLimits` in `telegram-rate-limits.ts`. A method without a line has no rate limit. See [Rate limits](apps/server/src/plugins/app/telegram/README.md#rate-limits).
- Send every user-facing text through `ctx.t`. Never log message text, callback data or tokens: `/start <token>` arrives as message text.
- Name a command in snake case, such as `new_invite`.
- Declare the access subjects of a domain next to its entity and take a typed view with `accessService.subjects<M>()`; do not augment a shared interface with `declare module`. Put a `guard` on every entry point, read lists through `access.accessibleBy` in the query, and check every write in the service with `access.assert` on the loaded document wrapped in `subject(name, document)`, never on the subject name. `plugins/app/access/README.md` explains why.

## Rules

- Recommend the design that is right for the architecture, not the one that is cheapest to build. State the cost as a fact for the decision, never as the reason for it; mention a cheaper workaround only as a trade-off.
- Use only TypeScript syntax that Node type stripping can erase: declare class fields and assign them in the constructor instead of parameter properties, and avoid `enum` and `namespace`. `erasableSyntaxOnly` in `apps/server/tsconfig.json` enforces it.
- A constructor takes each dependency as its own parameter and assigns it to a field; do not wrap the dependencies in one `<Class>Dependencies` object.
- Prefer `interface` over `type` for object shapes; use `type` for unions, intersections, mapped types and other cases where `interface` does not fit.
- Avoid redundancy in method names: `HotelsService.find()`, not `HotelsService.getHotels()`.
- Write comments and other text in the code in English.

### Tests

- Prefer tests that assert observable behavior through public boundaries (routes, plugins, services, real log output) over implementation details such as private state, cache internals, manually constructed AsyncLocalStorage stores, or call order.
- Test request-scoped Fastify behavior with real Fastify plugins, `app.inject`, and real request and log output instead of manually created request context stores.
- Keep test setup direct. When a test needs custom lifecycle choreography such as deferred hooks, manual cleanup ordering, or fake framework context, look for a simpler behavior boundary or a small explicit test helper.
- Do not remove meaningful behavior coverage while you simplify tests; keep behavior assertions such as nested logger child bindings even when you drop implementation-specific assertions.
- A shared test helper collects or exposes real observable output; it does not duplicate framework behavior with hidden one-off mocks.

## Infrastructure

- Node 26 and pnpm workspaces with a custom registry, npm.bambom.org. The pnpm version is pinned in `mise.toml` and in `packageManager`; keep both in sync. pnpm settings live in `pnpm-workspace.yaml`, and `.npmrc` keeps only the registry.
- `mise.toml` loads environment variables from the root `.env` file. `DATABASE_URL` and `VALKEY_URL` are there for local integration tests and feature work; use them when needed, but do not print secret values.
- Valkey must be 9.0 or newer, locally and in `TEST_VALKEY_URL` for CI: the Telegram session uses `HPEXPIRE`.
- The chart in `deploy/` does not deploy Valkey. `server-secrets-base` points every resource to `valkey-dev.valkey.svc.cluster.local`, which keeps data in memory, and `server-secrets-main` overrides it for production with `valkey.valkey.svc.cluster.local`, which persists data and never evicts keys.
- Every resource prefixes its Valkey keys with `smart-assistant:<RESOURCE_NAME>:` through the `keyPrefix` option in `kv-valkey.ts`, so preview resources share `valkey-dev` safely. Code passes keys without the prefix; only `SCAN` patterns and the keys it returns carry the full key.
- `ENVIRONMENT` (`production` | `preview`) is required. The chart sets `production` for `resourceName: main` and `preview` for every other resource; use `preview` in the root `.env` for local development. Preview pods share one bot token, so they do not set the webhook and the default commands on start. `POST /api/telegram/webhook/refresh` points the bot at a preview; preview also serves Swagger UI at `/api/docs`.
- `TIME_ZONE` is an IANA time zone, `UTC` by default, for users without their own `timeZone`. An invalid value stops the server on start.
- `scripts/create-server-secret.js` writes the `server-secrets-*` secret, with `INVITE_TOKEN` and `TIME_ZONE` when they are set. It replaces the whole secret.
- An unhandled promise rejection does not stop the server: `unhandled-rejection-reporter.ts` logs it and counts it in `unhandled_rejections_total`. An uncaught exception still closes the server through `close-with-grace` in `server.ts`.
- `tsc` is TypeScript 7 from the `@typescript/native` alias. `typescript` resolves to `@typescript/typescript6`, because typescript-eslint needs the TypeScript 6 API until TypeScript 7.1. The root `node_modules/.bin` has the TypeScript 7 language server, `tsc --lsp`; a `tsserver`-based editor plugin falls back to its bundled TypeScript.
