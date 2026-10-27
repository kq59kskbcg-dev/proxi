# Proxi

AI chat assistant built on Claude, deployed on Vercel, with a Mintlify help center.

## Layout

| Path | What it is | Deployed by |
|---|---|---|
| `apps/web` | The chat app: page, API functions, tests and Vercel config | Vercel (Root Directory: `apps/web`) |
| `apps/web/index.html` | The app itself (Vue 3 from a CDN, no build step) | |
| `apps/web/api/` | Serverless functions: `chat.js` (streams replies from Claude), `conversations.js` (saved chats), `feedback.js` (thumbs up / down) | |
| `apps/web/lib/` | Sign-in checks, redaction, attachment checks, rate limiting, chat storage and Langfuse setup | |
| `apps/web/test/` | Unit tests (`node --test`) | |
| `apps/web/testing/` | Helpers shared by the tests | |
| `apps/web/vercel.json` | Region and security headers, including the Content Security Policy | |
| `apps/docs` | Help center (Mintlify): features, privacy and security pages | Mintlify (docs path: `apps/docs`) |

## How the web app works

- Sign-in uses Clerk. The page only shows the chat to signed-in users, and every API endpoint rejects requests without a valid Clerk session token.
- Card numbers, IBANs, emails and phone numbers are masked before anything reaches the model, the logs or chat history.
- Attachments: images, PDFs and plain text, up to 3 files and 3 MB per message. Files are checked by their real contents and used for one request only; they are never stored (saved chats only remember that an image, PDF or file was attached). Text files are redacted like typed messages. PDFs are scanned and refused if they contain a card number or IBAN. Images can't be scanned, so the page warns about that.
- Chats are stored redacted in Postgres (Neon), keyed by the user's Clerk ID.
- Thumbs up / down are stored as Langfuse scores.

## Environment variables (set in Vercel)

| Name | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLERK_SECRET_KEY` | Verifies sign-in on the server. Without it, the API refuses every request. |
| `DATABASE_URL` | Postgres connection string, added automatically when you connect a Neon database in Vercel. Tables are created on first use. |
| `CLERK_AUTHORIZED_PARTIES` | Optional: comma-separated site URLs allowed to use sign-in tokens. Defaults to the site's own URL. |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Optional: tracing, prompts and feedback in Langfuse |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` (EU) |

The system prompt can be edited in Langfuse as a text prompt named `proxi-system` with the label `production`. Without it, the built-in prompt in `apps/web/lib/langfuse.js` is used.

## Tests

The tests cover redaction, attachment checks (including real PDF parsing) and chat storage, against an in-memory Postgres. Run them from the web app's folder:

```
cd apps/web
npm install
npm test
```

## Docs

Preview the help center locally with the Mintlify CLI:

```
cd apps/docs
npx mintlify dev
```
