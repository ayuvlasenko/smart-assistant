# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev -w server          # Build + watch + hot-reload server
npm run build -w server        # Clean build
npm run lint -w server         # ESLint
npm run format -w server       # ESLint fix + Prettier
npm test -w server             # Tests (node native test runner)
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

## Infrastructure

- Node 24, npm workspaces, custom registry (npm.bambom.org)
- Docker multi-stage builds via docker-bake.hcl
- Helm + ArgoCD for Kubernetes deployment
