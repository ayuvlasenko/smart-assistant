---
worth: later
where: apps/server/src/plugins/app/telegram/telegram-command-menus.ts:82
added: 2026-11-17
---

# two overlapping refreshes of the menus of a bot can leave a mixed menu

`TelegramCommandMenus.refresh` builds the menus of a bot, sets them with one `setMyCommands` call per language and then stores their hash under `telegram:<telegramId>:commands:menu`. Nothing serializes two refreshes of one bot. When a refresh with newer menus and a refresh with older menus overlap, the older one can write a language after the newer one did, and the newer one can store its hash last. The bot then shows the older commands in that language, and `syncBot` finds the hash of the newer menus and sets nothing.

It needs two refreshes of one bot with different menus within the few seconds that the calls take: two changes of the modules or of the default grants in a row, on one pod or on two, or such a change during a production start. The wrong menu stays until the next change of the menus of the bot, a `refresh` from `🔄 Token`, `🔀 Move` or the webhook refresh, or the end of the 30 days of the hash. Every command still passes its guard, so the menu only shows a command that answers nothing, or hides one that works.

Not decided: whether this happens in practice with one admin per bot. Decide when a bot shows a wrong menu in one language after a change, or when several admins change the modules of one bot. The fix is a lock per Telegram bot from `LockService` around `refresh`, with the menus built after the lock is taken.
