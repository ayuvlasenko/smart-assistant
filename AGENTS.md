# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

All commands should be run from the project root using npm workspaces:

### Backend Server

```bash
npm run dev -w server        # Build TypeScript and start server with hot reload
npm run build -w server      # Compile TypeScript only
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
- order functions top-down so callers appear above the helpers they use
- use kebab case for file and directory names
- keep tests near the related files by default; exception: migration tests must live in `apps/server/src/test/migrations/` because files in `apps/server/migrations/` are executable migrations
- if a design spec or implementation plan under `docs/superpowers/` is created or updated during the task, commit that document before starting or resuming implementation changes
- avoid redundancy in method names (e.g., `HotelsService.find()` not `HotelsService.getHotels()`)
- run `npm run format -w <workspace>` after implementing features
- prefer `mv` over rewriting a file when relocating content — avoids unnecessary context consumption and risk of LLM-introduced changes
- focus on fixing TypeScript errors and actual code issues
- Skip formatting issues like missing newlines, fix them only when requested
- Use the lint command above to check for linting errors
- commit messages, comments and other text should be in English

## Infrastructure

- Node 24, npm workspaces, custom registry (npm.bambom.org)
- Docker multi-stage builds via docker-bake.hcl
- Helm + ArgoCD for Kubernetes deployment
