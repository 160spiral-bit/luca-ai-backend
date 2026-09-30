# Agent-loop test cases (for runAgentTurnStream work)

Manual regression cases for the real iterative agent loop. Each case: trigger,
current one-shot behavior, and the correct behavior once the loop ships.

## CASE-001: both tool calls fail -> don't narrate and stop

- **Trigger:** a request needing 2+ tool calls (e.g. search, then read a result
  page) where BOTH calls fail — e.g. `ERROR: Blocked host` on one host and
  `ERROR: Page too large` (or another fetch failure) on the other.
- **Current (one-shot) behavior:** the turn narrates unfinished intent
  ("I'll look that up…", "let me fetch…") and then stops — trailing off
  mid-sentence with no answer and no acknowledgement of failure.
- **Correct behavior (agent loop):** EITHER retry with a different source
  (re-search with a refined query, pick the next result URL, fall back to a
  second provider's snippets) OR give an honest `couldn't verify` answer
  ("I couldn't load either source, so here's what I can say from search
  snippets… / I can't confirm this right now") — never a trailing fragment.
- **Notes:**
  - Partial results count: one failed call + usable snippets from the other
    is a success path, not a failure path.
  - The honest-failure answer must still pass the scrub pipeline
    (identity/tags/cutoff) like any final text.
  - Related fixes shipped alongside this case: fetch_page tool rows show
    the plain URL (not raw JSON args); IPv6 SSRF check allows public
    global unicast (benchlm.ai false "Blocked host"); oversize pages are
    truncated to the size limit instead of discarded.
