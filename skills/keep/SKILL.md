---
name: keep
description: Saves an AI answer from the current conversation to the keepr dashboard (saved-answers list), including the open points the user wants to come back to later. Use when the user says /keep, "keep this", "remember this answer", "save this to the dashboard", "I'll come back to this later", or in German "merk dir das", "leg das ins dashboard", "speicher die antwort", "darauf komme ich später zurück".
---

# Keep an answer

Saves an answer with the `keepr` CLI. The text is taken **automatically from the Claude transcript**,
so you don't have to retype it. You only provide the title, summary and points.

## Steps

1. Decide which answer is meant:
   - Default: your answer right before this instruction → `--back 1`
   - "the one before that" → `--back 2`, and so on
   - Only part of an answer, or something combined → pass the content via `--stdin` (see below).
2. Split the answer into **points**: every standalone recommendation, open question, decision
   or step the user might want to come back to individually, as a short sentence (≤ 120 characters).
   If the user named specific points or a follow-up question in the arguments, use exactly those.
   For an answer without clearly separable points: no points.
3. Run it (one Bash call). Write title, summary and points in the language of the conversation.

```bash
keepr save --back 1 \
  --title "Short, descriptive title (≤ 60 characters)" \
  --summary "One sentence: what it is about and what is still open" \
  --point "First point" --point "Second point" \
  --tag topic
```

   Part of an answer instead of the whole one:

```bash
keepr save --stdin --title "…" --point "…" <<'KEEPR_EOF'
<Markdown content>
KEEPR_EOF
```

4. Reply to the user in **one line**: ID, title, number of points. The output of `keepr save`
   contains a dashboard link you can include.

If the user wants points turned into tasks right away: afterwards, for each point,
`keepr task add --from A<n> --point <nr>` (the title is taken from the point).

If `keepr` is not on the PATH, use `node "${CLAUDE_PLUGIN_ROOT}/keepr.mjs"` instead (same arguments).
