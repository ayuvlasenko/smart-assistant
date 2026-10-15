# AGENTS.md

## Commands

Run all commands from the project root:

```bash
pnpm --filter server dev        # Build TypeScript and start server with hot reload
pnpm --filter server build      # Compile TypeScript only
pnpm --filter server typecheck  # Run full TypeScript checks, including tests and fixtures
pnpm test                       # Run all tests: root scripts and every workspace
pnpm --filter server test       # Run server tests
pnpm --filter server lint       # Run ESLint for backend
pnpm --filter server format     # Run ESLint fix + Prettier for backend
pnpm format                     # Format root scripts and all workspaces
pnpm lint:md                    # Check Markdown formatting
pnpm --filter <workspace> add <package>
```

Run a single test file:

```bash
pnpm --filter server exec node --env-file=.env.test --import tsx --test src/path/to/file.test.ts
```

Manage MongoDB migrations with `pnpm --filter server migrate:create|migrate:up|migrate:down|migrate:status`.

## Architecture

Monorepo using pnpm workspaces. Main app: `apps/server/` — Fastify 5, MongoDB (plain driver), TypeBox for validation/schemas.

Telegram bot uses `@grammyjs/types` for type safety and plain `fetch` for Bot API calls. Do not add a bot framework or any other Telegram library; the update routing and scenes are implemented in the project.

The bot works in private chats only. The update pipeline ignores updates from groups and channels, so do not add group-specific behavior such as reply targets or forum topics.

### Server Autoload Order

Fastify autoload processes directories sequentially — order matters for dependency resolution:

1. `plugins/external/` — third-party plugin wrappers
2. `plugins/app/` — services and repositories
3. `routes/` — route definitions with `autoHooks` and `cascadeHooks`

### Project Structure

- Each domain lives in `plugins/app/<domain>/` with its services, repositories, entities, schemas, scenes, steps, and tests. Keep exactly one level: no subdirectories inside a domain and no `index.ts`.
- A service or repository file exports its class and registers it as a plugin with `export default fp(...)`. Only plugin files use `export default`; every other file uses named exports, because autoload loads any default-exported plugin and skips the rest.
- `plugins/app/telegram/` holds the Telegram transport and the scene engine with generic steps. It does not import feature domains; a domain registers its own scenes and commands through the Telegram router.
- Shared infrastructure (`cache-service.ts`, `lock-service.ts` with `lock-errors.ts`, `app-logger.ts`, `metrics-service.ts`, `unhandled-rejection-reporter.ts`) stays at the top level of `plugins/app/`. `routes/` holds HTTP routes only.
- Shared schemas (env, HTTP errors, common fields) stay in `src/schemas/`. A domain schema stays in the single file that uses it, or in `<domain>-schemas.ts` when several files use it.
- Build every interaction that keeps state between updates as a scene: `defineScene` with a TypeBox `state` schema, a `ttl` and an optional `maxAge`, `router.scene`, and `sceneEngine.start(ctx, scene, state)`. A scene lives in the user's session until it calls `scene.end()` or its TTL runs out, and a user can have many scenes at once. Give a scene a `key` when one instance per business entity is enough, for example the id of the entity: a second `start` with the same key reuses the running scene. The engine saves every scene that the update touched, also when a handler fails: a failed handler keeps the changes it made before the error, so call the domain and check the data first, then change `scene.state`. A failed input step drops the input.
- Mark a scene `blocking: true` with a `title` when the user must finish it before anything else starts, such as a wizard. While a blocking scene runs, `sceneEngine.start` refuses every other scene: the engine replies with the titles of both scenes, when the new scene has one, and `start` returns `false`, so check it before the handler continues. A second `start` of the running blocking scene shows it again, also without a `key`. The buttons of other running scenes keep working, but their `scene.ask` gets the same refusal, so only the blocking scene's input can wait for text. A blocking scene also refuses to start while the input of another scene waits for text. `/cancel` ends a running blocking scene: it cancels the scene's input, which runs the input's `cancel` hook, and removes the buttons of the slot messages; without a blocking scene, `/cancel` cancels the waiting input.
- A scene handler gets the context and the scene as separate arguments, `(ctx, scene)` or `(ctx, scene, value)`; a step gets `(ctx, input)`. The context only talks to Telegram; the scene object holds `state`, `button`, `ask` and `end`. The domain plugin that registers a scene creates it with a factory, `create<Name>Scene(dependencies)`, that receives the services and `telegramSceneEngine` it needs, so a handler starts another scene with `sceneEngine.start(ctx, otherScene, state)` from the closure.
- Keep business data, such as an entity shared by several users, in its domain repository. A scene keeps only the user's view of it, such as the id of the entity or the current page.
- Collect typed answers through a named scene input: `inputs` with a TypeBox `payload`, `steps`, and `complete`, started by `scene.ask(name)`. Only one input of a user waits for text at a time; another `ask` gets a reply that the user must finish or `/cancel` first. `/cancel` cancels the input, not the scene, unless the scene is blocking. Set `cleanup: true` to delete the questions and the answers of each step once the step accepts an answer. Reuse `textStep`, `numberStep`, `dateStep`, and `choiceStep` from `telegram-steps.ts` before you write a custom step.
- Create every inline button with `scene.button(text, name, value)` for a handler in the scene's `buttons`, or with `input.button` inside a step. Do not write `callback_data` by hand: the scene keeps the button values, and `callback_data` holds only `<sceneId>:<buttonId>`. A button press does not need the input focus, so the buttons of every running scene work at the same time.
- Show a message that changes with the scene state as a slot: a function in the scene's `slots` that returns `TelegramMessageContent` (`text`, `rich` or `media`) or `undefined`. The engine renders the slots of every scene that the update touched once, after the update succeeds, and edits, replaces or deletes the message itself, so a handler only changes the state. A reply sent in the same handler comes before the slot messages. Do not track the message ids of a slot by hand. Choose what happens to the slot messages when the scene ends with `scene.end({ messages })`.
- Update the scenes of other users through domain events, never by writing to their sessions. `plugins/external/emittery.ts` registers one `Emittery` instance as `eventEmitter`; a domain narrows it to its own event map with `fastify.getDecorator<Emittery<<Domain>Events>>("eventEmitter")` and prefixes its event names with the domain, such as `<domain>.<entity>Changed`. A domain service emits its event after it saves the change. The domain plugin that registers a scene subscribes to the event with `on` and redraws the scenes that show the data. When any user may look at the data, give the scene `watch(state)`, which returns the topics the scene shows now, such as `<domain>.<entity>:<id>`, and call `telegramChats.publish(topics)`: the engine indexes every scene under its topics on save and redraws the scenes that still watch them. When the domain knows the users, or a scene must change its state or send a notification, call `telegramChats.deliver(scene, targets, handle?)`: `targets` are the user ids and scene keys to update, and the optional `handle` runs under that user's session lock without an incoming update. `publish` and `deliver` return at once and run in the background, so `emit` never waits for other users' sessions. The engine renders the slots afterwards, so without `handle` the scene only redraws, and a handler only changes the state or sends a notification. Tests wait for both with `telegramChats.idle()`.
- Register the grants of a domain with `accessService.register`. Put `guard: accessService.guard(action, subject)` on every command, deep link, scene, scene button and scene input that needs a permission, and enforce the rule in the service: read through `accessService.accessibleBy(actor, action, subject)` in the query, and check a write with `accessService.assert(actor, action, subject(name, document))` from `@casl/ability` on the loaded document, never on the subject name. `plugins/app/access/README.md` explains the model.
- Handle a link into the bot with `router.deepLink(name, handler)` and build its URL with `telegramBotService.resolveDeepLinkUrl({ name, value })`, never by hand: Telegram links can only send `/start <payload>`, so the payload is `<name>_<value>`. `plugins/app/telegram/README.md` describes the format.
- Build pagination with `pageOf` and `pageButtons` from `telegram-pagination.ts`.
- Log update ids, types and outcomes, never message text, callback data or tokens: `/start <token>` arrives as message text.
- Send every user-facing bot text through `ctx.t`. A domain keeps its texts in `<domain>-locales.ts` for `en`, `uk`, and `ru`, declares its namespace in `ResourceNamespaceMap`, and registers it with `I18nService.addLocales`.
- Name a file after its main export in kebab case with the domain prefix, so every file name is unique: `users-repository.ts` (`UsersRepository`), `accounts-service.ts`, `user-entity.ts`, `accounts-schemas.ts`, `create-account-scene.ts` (`createAccountScene`), `choose-account-step.ts`. A test is `<file>.test.ts`.
- A file holds one abstraction: its main export, the types of its own public API, and private helpers. A type, schema, constant or function that describes another abstraction's data lives in that abstraction's file. A domain keeps its errors in `<domain>-errors.ts` and its events in `<domain>-events.ts`: one interface that maps every event name of the domain to its payload. `telegram-router.ts` is the reference.
- Keep small functions of one topic together in one file, such as the parsers of typed input; do not give each function its own file. Split a file by abstraction, never by kind of code: do not create `*-types.ts`, `*-constants.ts` or `*-utils.ts`. Only `<domain>-errors.ts`, `<domain>-events.ts`, `<domain>-schemas.ts` and `<domain>-locales.ts` collect one kind of code for the whole domain.
- Order a file the same way every time: imports, then the types, schemas, constants and `declare module` augmentations of the file, then the main export, then private helpers in the order of their first use. A file that exports a class ends with the plugin that registers it, `export default fp(...)`. In a file without a class the plugin is the main export, and its helpers follow it.
- Treat a source file over about 400 lines as a sign of a second abstraction inside it: find it and move it to its own file, such as one screen of a scene with several screens. `pnpm --filter server lint` warns about these layout rules through `max-lines` and the local rule `local/file-layout` in `apps/server/eslint-rules/`; `src/server.ts` and tests are exempt. Fix a warning in the code you touch.

### Plugin DI

Services are classes registered as Fastify decorators via `fastify-plugin` with explicit `dependencies` arrays. Routes access them via `fastify.getDecorator<T>()`.

### Route File Naming

Route files must match their parent directory name for correct autoload prefix mapping (e.g., `telegram/telegram.ts` gets prefix `/api/telegram`).

## Bot UX

- Keep the chat free of service buttons. Mention `/cancel` once, in the first question of an input, instead of attaching a cancel button to every message.
- Mention step commands such as `/skip` in the prompt text of the step that accepts them.
- Name a command in snake case: lowercase Latin letters, digits and underscores, such as `/new_invite`, at most 32 characters. Telegram accepts only these characters in the command menu, and `router.command` rejects any other name.
- Use inline buttons only when the user picks from a set of options, such as an account or a date. Accept typed text for free-form input.
- Update the existing message for pagination and similar controls instead of sending a new one: show it as a slot and keep the page in the scene state.

## Rules

- use only TypeScript syntax that Node type stripping can erase: declare class fields and assign them in the constructor instead of parameter properties, and avoid `enum` and `namespace`. `erasableSyntaxOnly` in `apps/server/tsconfig.json` enforces it
- a constructor takes each dependency as its own parameter and assigns it to a field; do not wrap the dependencies in one `<Class>Dependencies` object
- prefer `interface` over `type` for object shapes; use `type` for unions, intersections, mapped types, and other cases where `interface` is not a good fit
- use TypeScript module augmentation when needed for third-party plugin types; for app-owned Fastify decorators and services, prefer typed local retrieval with `fastify.getDecorator<T>()` instead of broad app-wide instance augmentation
- order functions top-down so callers appear above the helpers they use
- use kebab case for file and directory names
- avoid redundancy in method names (e.g., `HotelsService.find()` not `HotelsService.getHotels()`)
- keep tests near the related files by default
- prefer tests that assert observable behavior through public boundaries (routes, plugins, services, real log output) over implementation details such as private state, cache internals, manually constructed AsyncLocalStorage stores, or call order
- when testing request-scoped Fastify behavior, use real Fastify plugins, `app.inject`, and real request/log output instead of manually creating request context stores
- keep test setup direct; if a test needs custom lifecycle choreography such as deferred hooks, manual cleanup ordering, or fake framework context, stop and look for a simpler behavior boundary or a small explicit test helper
- do not remove meaningful behavior coverage while simplifying tests; preserve behavior assertions such as nested logger child bindings even when dropping implementation-specific assertions
- shared test helpers should collect or expose real observable output, not duplicate framework behavior with hidden one-off mocks
- run `pnpm --filter <workspace> format` after implementing features
- lint does not replace TypeScript checking; run `pnpm --filter server typecheck` when you need compiler diagnostics, especially for tests and files under `src/test/` that are excluded from `build`
- commit messages, comments and other text should be in English

## Infrastructure

- Node 26, pnpm workspaces, custom registry (npm.bambom.org). The pnpm version is pinned in `mise.toml` and in `packageManager`; keep both in sync. pnpm settings live in `pnpm-workspace.yaml`, and `.npmrc` keeps only the registry.
- `mise.toml` loads environment variables from the root `.env` file. `DATABASE_URL` and `VALKEY_URL` are available there for local integration tests and feature work; use them when needed, but do not print secret values.
- Valkey must be 9.0 or newer: the Telegram session is a hash `telegram:session:<userId>` whose fields expire on their own through `HPEXPIRE`. This applies to the local Valkey and to the one in `TEST_VALKEY_URL` for CI.
- The chart does not deploy Valkey. The server takes `VALKEY_URL` from its secrets: `server-secrets-base` points every resource to `valkey-dev.valkey.svc.cluster.local`, which keeps data in memory, and `server-secrets-main` overrides it for production with `valkey.valkey.svc.cluster.local`, which writes an append-only file to a volume and never evicts keys. Every resource prefixes its keys with `smart-assistant:<RESOURCE_NAME>:` through the `keyPrefix` option of the ioredis client in `kv-valkey.ts`, so preview resources share `valkey-dev` safely. Code passes keys without the prefix; only `SCAN` patterns and the keys it returns carry the full key.
- `ENVIRONMENT` (`production` | `preview`) is required. The Helm chart in `deploy/` sets `production` for `resourceName: main` and `preview` for every other resource. Preview pods share one bot token, so they skip `setWebhook` and the default commands on start and expose `POST /api/telegram/webhook/refresh` plus Swagger UI at `/api/docs`. The refresh points the webhook and the default commands at this preview and makes every chat menu sync again on its next update. Use `ENVIRONMENT=preview` in the root `.env` for local development.
- `INVITE_TOKEN` is optional and must match `[A-Za-z0-9_-]{1,57}`, so that `invite_<INVITE_TOKEN>` fits the 64 characters of a Telegram deep link. While no user has the `admin` grant, `/start invite_<INVITE_TOKEN>` is a single-use invite that makes its first user the admin; `plugins/app/invites/README.md` describes the bootstrap. `scripts/create-server-secret.js` writes it to the `server-secrets-*` secret when it is set, and the script replaces the whole secret.
- `TIME_ZONE` is an IANA time zone, `UTC` by default. It sets the calendar day for users without their own `timeZone`, for example for `dateStep`. An invalid value stops the server on start. The secret script writes it when it is set.
- An unhandled promise rejection does not stop the server: `unhandled-rejection-reporter.ts` logs it and counts it in `unhandled_rejections_total`, and `close-with-grace` in `server.ts` skips it. An uncaught exception still closes the server through `close-with-grace`, because Node can't resume safely after it.
- `tsc` is TypeScript 7 from the `@typescript/native` alias. `typescript` resolves to `@typescript/typescript6` (`tsc6`), because typescript-eslint needs the TypeScript 6 API until TypeScript 7.1. The root package also installs `@typescript/native`, so an editor finds the TypeScript 7 language server (`tsc --lsp`) in the root `node_modules/.bin`; `@typescript/typescript6` has no `tsserver.js`, so a `tsserver`-based editor plugin such as vtsls falls back to its bundled TypeScript.
