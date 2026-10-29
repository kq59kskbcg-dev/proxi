# Proxi

## Prompts in Langfuse

The app reads its prompts from Langfuse, using the `production` label.

- Never put the `production` label on a prompt version any other way than `npm run promote -- <prompt name> <version>` (run in `packages/agent`). It runs the prompt's eval first and refuses to promote if it fails.
- Create new versions with a different label, such as `test`. Never create or move a version straight to `production`.
- Prompts with an eval are listed in `packages/agent/scripts/prompt-evals.js`. A prompt without one is refused unless `--skip-eval` is passed, and only do that when the user asks for it.
- When an eval fails because of a real mistake seen in use, add that message to the dataset in Langfuse.
- The scripts need `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (and `LANGFUSE_BASE_URL` outside the EU cloud) and `ANTHROPIC_API_KEY`.

## Pull requests

Every pull request follows `.github/pull_request_template.md`, and two sections are required:

- **Release notes:** 1 to 5 short bullets, written for the people who use Proxi. Say what changes for them, not which files changed. Write "No user-facing changes" when there are none.
- **Docs:** before opening the pull request, check the help center (`apps/docs`, published by Mintlify from `main`) for anything the change makes missing or outdated. Search the docs for the feature's names, labels and terms, including old names that were replaced. Update or add pages in the same pull request, and add new pages to `docs.json`. List what changed, or say why nothing needed to.
