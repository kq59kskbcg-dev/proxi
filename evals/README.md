# Evals

Quality checks for the agent. The datasets, prompts for the judges and all scores live in Langfuse; the code that runs them lives here.

## search-docs

`npm run search-docs -w @proxi/evals` sends each question of the Langfuse dataset `evals/search-docs` (one per help center page) through the real chat route, with a local MCP server and the real docs search. Each reply is scored by the 10 judge prompts (`evals/*` in Langfuse) and a check that the expected page was found. Scores are saved on the traces, and the gate decides pass or fail:

- Hard (every item must pass): correctness, groundedness, privacy, tool-use at 4 or more, and the page found in the top 3 results.
- Soft: resolution, completeness, clarification, tone, context-relevance, context-recall. The average must be at least 4 and no item below 3.

Needs these environment variables:

| Variable | Why |
|---|---|
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Read the dataset and prompts, save scores (`LANGFUSE_BASE_URL` outside the EU cloud) |
| `ANTHROPIC_API_KEY` | The chat and the judges |
| `MINTLIFY_API_KEY` | The docs search in the MCP server |

Also run `npm ci` in `apps/mcp` once, because the runner starts that server locally. Optional: `EVAL_MODEL` (chat model, default `Sonnet 5.5`), `EVAL_JUDGE_MODEL`, `EVAL_JUDGE_LABEL` (default `latest`) and `EVAL_RUN_NAME`.

Not done yet: failing a run when a score drops against the last run on `main`.
