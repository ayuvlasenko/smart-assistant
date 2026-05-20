# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Mirror of `AGENTS.md`. Keep both files in sync — see the sync rule under Rules.

## Commands

All commands should be run from the project root using npm workspaces:

### Backend Server

```bash
npm run dev -w server        # Build TypeScript and start server with hot reload
npm run build -w server      # Compile TypeScript only
npm run typecheck -w server  # Run full TypeScript checks, including tests and fixtures
npm run watch -w server      # TypeScript watch mode
npm run dev:start -w server  # Start Fastify server with file watching
```

### Linting & Formatting

```bash
npm run lint -w server          # Run ESLint for backend
npm run format -w server        # Run ESLint fix + Prettier for backend
npm run format --workspaces     # Format all workspaces
```

### Package Management

```bash
npm install -w <workspace> <package>     # Install package in specific workspace
```

## Architecture

Monorepo using npm workspaces. Main app: `apps/server/` — Fastify 5, MongoDB (plain driver), TypeBox for validation/schemas.

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
- if a design spec or implementation plan under `docs/superpowers/` is created or updated during the task, commit that document before starting or resuming implementation changes
- if you are explicitly asked to use Superpowers or a Superpowers skill/plugin, do not skip its required workflow steps; follow the requested process end-to-end before claiming completion
- when executing Superpowers implementation plans, prefer subagent-driven development
- avoid redundancy in method names (e.g., `HotelsService.find()` not `HotelsService.getHotels()`)
- run `npm run format -w <workspace>` after implementing features
- prefer `mv` over rewriting a file when relocating content — avoids unnecessary context consumption and risk of LLM-introduced changes
- focus on fixing TypeScript errors and actual code issues
- skip formatting issues like missing newlines, fix them only when requested
- use the lint command above to check for linting errors
- lint does not replace TypeScript checking; run `npm run typecheck -w server` when you need compiler diagnostics, especially for tests and files under `src/test/` that are excluded from `build`
- commit messages, comments and other text should be in English
- `CLAUDE.md` and `AGENTS.md` must stay in sync — any edit to one must be applied to the other in the same change (content is identical except for the top heading/intro)

## Infrastructure

- Node 24, npm workspaces, custom registry (npm.bambom.org)
- `mise.toml` loads environment variables from the root `.env` file. `DATABASE_URL` and `VALKEY_URL` are available there for local integration tests and feature work; use them when needed, but do not print secret values.
- Docker multi-stage builds via docker-bake.hcl
- Helm + ArgoCD for Kubernetes deployment
