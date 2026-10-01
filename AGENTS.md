# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

> Mirror of `CLAUDE.md`. Keep both files in sync — see the sync rule under Rules.

## Commands

All commands should be run from the project root using pnpm workspaces:

### Backend Server

```bash
pnpm --filter server dev        # Build TypeScript and start server with hot reload
pnpm --filter server build      # Compile TypeScript only
pnpm --filter server typecheck  # Run full TypeScript checks, including tests and fixtures
pnpm --filter server test       # Run tests
pnpm --filter server watch      # TypeScript watch mode
pnpm --filter server dev:start  # Start Fastify server with file watching
```

### Linting & Formatting

```bash
pnpm --filter server lint       # Run ESLint for backend
pnpm --filter server format     # Run ESLint fix + Prettier for backend
pnpm format                     # Format root scripts and all workspaces
```

### Package Management

```bash
pnpm --filter <workspace> add <package>     # Install package in specific workspace
```

## Architecture

Monorepo using pnpm workspaces. Main app: `apps/server/` — Fastify 5, MongoDB (plain driver), TypeBox for validation/schemas.

Telegram bot uses `@grammyjs/types` for type safety and plain `fetch` for Bot API calls (no bot framework).

Old NestJS project at `~/github/projects/expense-assistant` serves as migration reference.

### Server Autoload Order

Fastify autoload processes directories sequentially — order matters for dependency resolution:

1. `plugins/external/` — third-party plugin wrappers
2. `plugins/app/` — services and repositories, grouped by domain in subdirectories
3. `routes/` — route definitions with `autoHooks` and `cascadeHooks`

### Plugin DI

Services are classes registered as Fastify decorators via `fastify-plugin` with explicit `dependencies` arrays. Routes access them via `fastify.getDecorator<T>()`.

### Route File Naming

Route files must match their parent directory name for correct autoload prefix mapping (e.g., `telegram/telegram.ts` gets prefix `/api/telegram`).

## Rules

- use `jq` for JSON formatting, not `python3 -m json.tool`
- don't write comments that are redundant with code
- comments should be only written if you asked for them or for not obvious logic
- prefer `interface` over `type` for object shapes; use `type` for unions, intersections, mapped types, and other cases where `interface` is not a good fit
- use TypeScript module augmentation when needed for third-party plugin types; for app-owned Fastify decorators and services, prefer typed local retrieval with `fastify.getDecorator<T>()` instead of broad app-wide instance augmentation
- order functions top-down so callers appear above the helpers they use
- use kebab case for file and directory names
- keep tests near the related files by default
- prefer tests that assert observable behavior through public boundaries (routes, plugins, services, real log output) over implementation details such as private state, cache internals, manually constructed AsyncLocalStorage stores, or call order
- when testing request-scoped Fastify behavior, use real Fastify plugins, `app.inject`, and real request/log output instead of manually creating request context stores
- keep test setup direct; if a test needs custom lifecycle choreography such as deferred hooks, manual cleanup ordering, or fake framework context, stop and look for a simpler behavior boundary or a small explicit test helper
- do not remove meaningful behavior coverage while simplifying tests; preserve behavior assertions such as nested logger child bindings even when dropping implementation-specific assertions
- shared test helpers should collect or expose real observable output, not duplicate framework behavior with hidden one-off mocks
- avoid redundancy in method names (e.g., `HotelsService.find()` not `HotelsService.getHotels()`)
- run `pnpm --filter <workspace> format` after implementing features
- prefer `mv` over rewriting a file when relocating content — avoids unnecessary context consumption and risk of LLM-introduced changes
- focus on fixing TypeScript errors and actual code issues
- skip formatting issues like missing newlines, fix them only when requested
- use the lint command above to check for linting errors
- lint does not replace TypeScript checking; run `pnpm --filter server typecheck` when you need compiler diagnostics, especially for tests and files under `src/test/` that are excluded from `build`
- commit messages, comments and other text should be in English
- `CLAUDE.md` and `AGENTS.md` must stay in sync — any edit to one must be applied to the other in the same change (content is identical except for the top heading/intro)

## Infrastructure

- Node 26, pnpm workspaces, custom registry (npm.bambom.org). The pnpm version is pinned in `mise.toml` and in `packageManager`; keep both in sync. pnpm settings live in `pnpm-workspace.yaml`, and `.npmrc` keeps only the registry.
- `mise.toml` loads environment variables from the root `.env` file. `DATABASE_URL` and `VALKEY_URL` are available there for local integration tests and feature work; use them when needed, but do not print secret values.
- `ENVIRONMENT` (`production` | `preview`) is required. The Helm chart sets `production` for `resourceName: main` and `preview` for every other resource. Preview pods share one bot token, so they skip `setWebhook` on start and expose `POST /api/telegram/webhook/refresh` plus Swagger UI at `/api/docs`. Use `ENVIRONMENT=preview` in the root `.env` for local development.
- `tsc` is TypeScript 7 from the `@typescript/native` alias. `typescript` resolves to `@typescript/typescript6` (`tsc6`), because typescript-eslint needs the TypeScript 6 API until TypeScript 7.1.
- Docker multi-stage builds via docker-bake.hcl
- Helm + ArgoCD for Kubernetes deployment
