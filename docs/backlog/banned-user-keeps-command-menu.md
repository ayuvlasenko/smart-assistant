---
worth: later
where: apps/server/src/plugins/app/telegram/telegram-bot-service.ts:160
added: 2026-10-15
---

# a user banned by hand keeps the last command menu

`TelegramBotService.syncCommands` returns at once for a banned user. A user who had access and was then banned by hand in MongoDB keeps the chat-scoped menu that `setMyCommands` set before. The menu shows commands the user can no longer run; the router drops their updates as `banned`, so nothing leaks, but the menu lies.

No code bans a user or removes a grant today: both are manual MongoDB edits, and they emit no `users.accessChanged`. Decide when a ban or a grant removal ships in `UsersService`: then it emits the event, and `syncCommands` clears the chat menu for a banned user with `deleteMyCommands` instead of returning.
