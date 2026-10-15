---
worth: yes
where: apps/server/src/plugins/app/telegram/telegram-chats.ts:266
added: 2026-10-16
---

# a background delivery waits for rate limit tokens while it holds the session lock

`publishAll` and `deliverAll` start a delivery for every recipient at once with `Promise.allSettled`. Each delivery takes the recipient's session lock first, and only then its Bot API calls wait in the `background` queue of `RateLimitQueue` for a global token. The 60 s `lockMaxHoldMilliseconds` timer runs from the moment the lock is taken.

Example: a `publish` to 500 watchers while there is interactive traffic. The background class gets 5 tokens per second (its 20% share of 25), so recipients after about the 300th hold their lock for 60 s while they wait. When such a user presses a button, the update waits for the lock for up to 60 s and keeps a webhook connection busy. Every recipient past about `60 s × background rate` fails with `LockHoldTimeoutError` and counts as `delivery_failed`, and its scene stays stale.

The proposed fix limits the concurrent background deliveries of a pod, for example to 5, with a permit that `TelegramChats` takes before `withUser` and gives back after the delivery. The other deliveries wait outside the lock, where no hold limit applies, so a lock is held for about one token wait.

Found by the revmux review `feature-telegram-rate-limiting/01-initial` of the Telegram rate limiter; deferred so the limiter can ship first.
