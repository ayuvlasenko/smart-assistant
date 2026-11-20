---
worth: later
where: apps/server/src/plugins/app/telegram/telegram-command-menus.ts
added: 2026-11-21
---

# a banned user of a bot without autoBan sees the menu of the bot

`TelegramCommandMenus.sync` removes the chat menu of a banned user with `deleteMyCommands`, and Telegram then shows the menu of the bot in that chat. In a bot with `users.autoBan` on, the newcomer is banned and the menu of the bot is empty, so nothing is wrong. In a bot with `users.autoBan` off, the menu of the bot lists `/start`, `/settings`, `/cancel` and the commands of the default grants, and a user banned by hand in MongoDB sees them; the router drops every one of them as `banned`, so nothing leaks, but the menu lies.

A fix sets an empty menu for the chat with `setMyCommands` instead of removing it. Not settled: whether the Bot API accepts an empty `commands` list for a chat scope; check it from a local script with the token of the preview bot. No code bans a user today, so decide when a ban ships in `UsersService`.
