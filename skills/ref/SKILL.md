---
name: ref
description: Loads an answer (A<n>), task (T<n>) or inbox item (I<n>) saved in the keepr dashboard as context, to answer a follow-up question about it or continue working on it. Use when the user says /ref A3, "regarding A3", "back to A3", "about point 2 of A5", "what was in A3 again", "which answers did I save", mentions an ID like A12/T7/I3, or in German "bezug auf A3", "zurück zu A3", "zu Punkt 2 aus A5".
---

# Refer to a saved answer

1. Load the context:
   - Answer: `keepr show A3` (question, full answer, numbered points, notes)
   - Task: `keepr task show T3` (incl. links to other tasks; load those too if they matter)
   - Inbox item: `keepr show I3` (to keep clarifying it, see the `inbox` skill)
   - No ID given / "what did I save": `keepr answers` and let the user pick.
2. Answer the user's follow-up based on this context. If they refer to a point ("point 2"),
   they mean the number from the points list.
3. Keep the state up to date:
   - Point resolved → `keepr point A3 2 --done`
   - New open question came up → `keepr point A3 "…"`
   - Follow-up still open → `keepr answer A3 --status followup`; everything resolved → `--status done`
   - Record an important insight briefly → `keepr answer A3 --note "…"`
   - If the new answer itself should be kept, use the `keep` skill afterwards.
4. Mention in one line what you updated in the dashboard.

If `keepr` is not on the PATH, use `node "${CLAUDE_PLUGIN_ROOT}/keepr.mjs"` instead (same arguments).
