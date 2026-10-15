---
worth: yes
where: apps/server/src/plugins/app/telegram/telegram-scene-buttons.ts:163
added: 2026-10-15
---

# scene buttons inside rich message blocks are not recorded

A rich message can carry callback buttons inside its content: a `buttons` block (`InputRichBlockButtons`) or a `button` rich text (`RichTextButton`). The scene engine does not see them. `TelegramSceneButtons.remember` reads button ids only from `markup.inline_keyboard` through `readOwnButtonIds`, and `TelegramContext` emits `messageSent` and `messageEdited` with the markup of `content.keyboard` only. A `scene.button(...)` placed inside `content.message.blocks` is therefore never stored for the message, and its press gets the expired-button reply.

Until this is fixed, slots keep every callback button in `keyboard`. Surfaced while designing the invite slots, which use rich messages for tables, checkbox lists and dates.

The fix needs `remember` to also walk the blocks of a rich message (nested `list`, `blockquote`, `details` blocks and rich text included), which means the context events must carry the rich content, not only the inline keyboard.
