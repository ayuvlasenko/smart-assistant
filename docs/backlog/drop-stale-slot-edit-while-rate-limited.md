---
worth: yes
where: apps/server/src/plugins/app/telegram/telegram-responder.ts:109
added: 2026-10-16
---

# a stale slot edit still waits for the rate limiter and is sent

When the Telegram rate limiter makes a slot edit wait, a newer edit of the same slot can arrive before the first one is sent. Both edits are sent, although the user only needs the last state. When a user pages through a list quickly, each click costs a slot in the chat bucket, and the queue of the chat grows.

The fix sends only the latest content of a slot: an edit that waits drops itself when a newer edit of the same message replaces it.

It does not work while every Bot API call runs inside the session lock of `TelegramSessionStore.withSession`: the next update waits for the lock that the waiting edit holds, so two edits of one slot never wait at the same time. The fix needs the slot edit to leave the lock: the handler records the content of the slot, and a sender outside the lock waits for the limiter and sends the latest content. A new message stays inside the lock, because the session keeps its `message_id`.

Deferred from the design of the Telegram rate limiter, which ships first with every call inside the lock.
