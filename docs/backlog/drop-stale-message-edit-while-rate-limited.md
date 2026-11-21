---
worth: later
where: apps/server/src/plugins/app/telegram/telegram-responder.ts:95
added: 2026-10-16
---

# a stale edit of a scene message still waits for the rate limiter and is sent

When the Telegram rate limiter makes the edit of a scene message wait, a newer edit of the same message can arrive before the first one is sent. Both edits are sent, although the user only needs the last state. When a user pages through a list quickly, each click costs a token in the chat bucket, and the queue of the chat grows.

The fix sends only the latest content of a message: an edit that waits drops itself when a newer edit of the same message replaces it.

It does not work while every Bot API call runs inside the session lock of `TelegramSessionStore.withSession`: the next update waits for the lock that the waiting edit holds, so two edits of one message never wait at the same time. The fix needs the edit to leave the lock: the handler records the content of the message, and a sender outside the lock waits for the limiter and sends the latest content. A new message stays inside the lock, because the scene record keeps its `message_id`.

Deferred from the design of the Telegram rate limiter, which ships first with every call inside the lock.

While every call runs inside the lock, the edits of one message wait one after another, so the cost is one token of the chat bucket per press, and a user who pages faster than the bucket refills waits for the edits that the earlier presses queued. Whether users page that fast is not measured: decide when `telegram_rate_limit_wait_seconds` of `editMessageText` shows interactive waits, since the fix is a redesign of where the edits run.
