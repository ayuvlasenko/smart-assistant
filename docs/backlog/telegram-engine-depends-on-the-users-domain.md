---
worth: later
where: apps/server/src/plugins/app/telegram/telegram-update-handler.ts
added: 2026-10-31
---

# the telegram engine depends on the users domain and on Env

The engine in `plugins/app/telegram/` imports `UserEntity`, `UsersService`, `UsersRepository` and `UsersEvents` from the users domain, and reads `Env` for its config. That is fine while one app uses the engine. It blocks moving the engine into a package that several bots share, because every bot would need our users collection and our env names.

Whether to do it is open until a second bot that reuses the engine is planned. Until then the decoupling only costs: an attempt in PR #18 was dropped because it added type plumbing with no benefit to one app. The attempt is kept on the local branch `backup/pr-18-engine-refactor` (86f8abd) in the worktree `jittery-gorilla`; it was never pushed.

What that attempt taught, for when the work starts:

- A port `TelegramUsers<TUser>` with `resolve(profile)`, `find(telegramId)` and `logFields(user)`, implemented by a users adapter, removes the runtime dependency. The adapter also takes over the `users.accessChanged` subscription that syncs the command menu. `telegram-bot-service` must not depend on the adapter plugin, or the plugins form a cycle.
- Keep the user type parameter only on what a domain writes or passes handlers to: the context, the guard, the scene and its control, the steps, the router and the chats. The scene engine erases it once when it registers, starts or delivers a scene, and the internals use `TelegramUser`. Threading it through every class cost about 440 occurrences in 17 files and gave no safety, because `getDecorator` is an unchecked cast anyway.
- Banning the import of `src/env.ts` loses the compile-time check of `Pick<Env, …>`. The engine then has to validate its config itself, for example with a TypeBox schema per service, or take typed options at the package boundary. Without it, a renamed env field reads as `undefined` and a new `ENVIRONMENT` value runs as production.
- A lint rule that forbids the imports must check every form of a module specifier: `import`, `export … from`, `import()`, `import("…")` in a type, `import x = require("…")` and `declare module "…"`.

Do it as part of the move into a package, where the public API is the package export, rather than as a boundary inside `apps/server`.
