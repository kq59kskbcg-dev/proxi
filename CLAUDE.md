# Proxi

## Prompts in Langfuse

The app reads its prompts from Langfuse, using the `production` label.

- Never put the `production` label on a prompt version any other way than `npm run promote -- <prompt name> <version>` (run in `packages/agent`). It runs the prompt's eval first and refuses to promote if it fails.
- Create new versions with a different label, such as `test`. Never create or move a version straight to `production`.
- Prompts with an eval are listed in `packages/agent/scripts/prompt-evals.js`. A prompt without one is refused unless `--skip-eval` is passed, and only do that when the user asks for it.
- When an eval fails because of a real mistake seen in use, add that message to the dataset in Langfuse.
- The scripts need `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (and `LANGFUSE_BASE_URL` outside the EU cloud) and `ANTHROPIC_API_KEY`.

## Pull requests

Every pull request follows `.github/pull_request_template.md`, with these required:

- **Release notes:** 1 to 5 short bullets, written for the people who use Proxi. Say what changes for them, not which files changed. Write "No user-facing changes" when there are none.
- **Release notes page:** add the same notes to `apps/docs/release-notes.mdx`, as a new `<Update>` entry at the top, labelled with the release date (or added to that date's entry if it already exists). Skip this when there are no user-facing changes.
- **Docs:** before opening the pull request, check the help center (`apps/docs`, published by Mintlify from `main`) for anything the change makes missing or outdated. Search the docs for the feature's names, labels and terms, including old names that were replaced. Update or add pages in the same pull request, and add new pages to `docs.json`. List what changed, or say why nothing needed to.

## Help center content

The help center (`apps/docs`) is public. Write it for people who use Proxi, or want to.

Belongs in the docs:
- What users can do and how: features, settings, limits they will notice (like the 50 memory limit).
- What happens to their data: what is stored, for how long, who processes it, and how to delete it.
- Known limitations that affect privacy or trust, stated plainly.
- How Proxi is built and tested, at the level of the architecture and testing pages.

Never in the docs:
- Secrets, API keys, tokens, internal URLs, environment variable values or database details.
- Details that help someone attack or abuse Proxi: rate limit numbers, redaction patterns, prompt text, classifier rules, safety thresholds.
- Personal data, except the contact address in the privacy policy and terms.
- Features that aren't shipped, roadmap promises or dates, unless the user explicitly asks for a page that describes planned work.

How to make claims:
- Describe only what the code does today. When unsure, check the code or leave it out.
- Claims about other products need a source link and a date, and must be checked against the provider's own pages.
- Avoid absolute words like "anonymous", "never" or "fully private" unless they are true without exceptions. If there's an exception, state it next to the claim.
- When a change removes or renames a feature, update or remove every mention of it.
