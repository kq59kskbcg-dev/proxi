# Proxi

## Prompts in Langfuse

The app reads its prompts from Langfuse, using the `production` label.

- Never put the `production` label on a prompt version any other way than `npm run promote -- <prompt name> <version>` (run in `apps/web`). It runs the prompt's eval first and refuses to promote if it fails.
- Create new versions with a different label, such as `test`. Never create or move a version straight to `production`.
- Prompts with an eval are listed in `apps/web/scripts/prompt-evals.js`. A prompt without one is refused unless `--skip-eval` is passed, and only do that when the user asks for it.
- When an eval fails because of a real mistake seen in use, add that message to the dataset in Langfuse.
- The scripts need `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (and `LANGFUSE_BASE_URL` outside the EU cloud) and `ANTHROPIC_API_KEY`.
