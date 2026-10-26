# flashcard

`list_cards` defaults to `filter="due"` when omitted; scope-specific IDs are still required. After rating, `nextSteps` supplies a readback call; the strict safety receipt determines commit status, and an empty native response is omitted rather than returned as `result: null`.

`skip=true` skips only in the current review session; it does not change repetitions or the persisted schedule. A strict `no_change` receipt is therefore expected. Continue using the returned `reviewSession.nextListArgs`. Omitting `reviewedCards` starts a new kernel session and clears skipped cards.

Strict writes require `validateOnly=true` first; submit `preflight.commitArgs` unchanged. Use the real `cardID` from `list_cards` or `get_cards`, not the note blockID/id. Resolved `get_cards` entries expose both IDs. Wrong-deck/missing cards and notebooks without write permission are rejected before review. Review receipts compare actual repetitions and last-review time. On readback failure, inspect the card and retain the request ID; do not automatically repeat a rating.

This tool covers review-first flashcard operations and deck management.

When to read this page: you need to list due cards, inspect decks, review cards, or turn blocks into flashcards.

Related pages:

- [Common Tasks](../common-tasks.md)

## Actions

| Group | Actions |
|------|---------|
| Read | `list_cards`, `get_decks`, `get_cards` |
| Review flow | `review_card` |
| Deck mutations | `create_card`, `remove_card` |

## Safety Rules

- `remove_card` requires explicit confirmation.

## MCP App

For MCP Apps clients, `flashcard(action="list_cards", scope="all", filter="due")` returns model-visible candidate summaries containing the prompt and scheduling metadata but no answer. Cards without a readable prompt are removed before the model selects. The result also includes an opaque `candidateToken` for a fixed ten-minute candidate snapshot. The model must copy that token unchanged, choose 1–20 cards only from the exact `cards` array in the same result, then call the App-only `flashcard_review_session` presentation tool with ordered `{ deckID, cardID }` pairs and a short `selectionReason`. Deck inventories, `get_cards`, earlier results, and guessed IDs are not valid selection sources. The presentation tool validates against this snapshot instead of drawing SiYuan's due queue a second time, so kernel sampling or daily-limit ordering cannot remove valid selections between the two calls. Notebook permission is still checked when the session starts.

The resulting inline App omits a redundant title bar and keeps the classic flow: view the prompt, reveal the answer, then choose Again, Hard, Good, or Easy. The model still receives the complete selected prompts and reference answers in `structuredContent`, but the successful result is marked `presentationMode: "mcp-app-only"` and instructs the model to reply only “复习界面已打开，请在卡片中完成本轮。” It must not repeat cards, start Q1 in chat, ask for chat answers, assign ratings, or call `review_card` itself. Each rating remains an App action through the existing `flashcard(action="review_card")` path and retains its action and permission checks. The App does not call AI or create chat turns during the round. The model resumes content discussion only if the user explicitly switches to chat-based review or, after the final card, clicks **Ask AI about this round** to send the explicit Socratic-teaching handoff.

When notebook read permission allows it, `list_cards` and `get_cards` hydrate each card from its `blockID` with separate `front` and `back` fields: the source block is the front and its direct child blocks are joined in order as the back. If the notebook is unreadable, permission loading fails, or notebook ownership cannot be resolved, only card IDs and scheduling metadata remain; note text, paths, and prompts already returned by the kernel are removed as well. If permission is confirmed but content hydration fails, the readable native record is retained.

Ratings are submitted through the model-hidden `flashcard_review_app_action` and controlled on the separate MCP Apps settings page; the ordinary `flashcard` Tool carries no UI resource. Clients without `io.modelcontextprotocol/ui` receive neither launchers nor App-only tools, while text, structured output, and CLI behavior remain unchanged.

## Notes

- `review_card` accepts either a `rating` or `skip=true`.
- `list_cards` accepts optional `reviewedCards`, matching SiYuan's review flow for filtering cards already handled in the current round.
- `list_cards(scope="all")` should omit `deckID`; an empty string is treated as omitted for compatibility. Non-empty `deckID` belongs with `scope="deck"`.
- `create_card` turns existing blocks into flashcards through SiYuan's `addRiffCards` flow, which writes deck attributes and registers card records transactionally. Non-built-in `deckID` values must already exist. `mode` is kept for compatibility.

## Action List

- `list_cards`
- `get_decks`
- `get_cards`
- `review_card`
- `create_card`
- `remove_card`
