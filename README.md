# Proxi

AI chat assistant built on Claude, deployed on Vercel, with a Mintlify help center.

## Layout

| Path | What it is | Deployed by |
|---|---|---|
| `apps/web` | The chat app: page, API functions, tests and Vercel config | Vercel (Root Directory: `apps/web`) |
| `apps/web/index.html` | The page shell and Vue template (Vue 3 from a CDN, no build step) | |
| `apps/web/style.css`, `apps/web/ui/` | The app's styles and browser code as native ES modules: `app.js` (sign-in and mounting), `store.js` (shared state), one module per area (`layout.js`, `sidebar.js`, `search.js`, `composer.js`, `chat.js`, `share.js`, `settings.js`, `memories.js`, `account.js`, `privacy-page.js`, `shared-page.js`), `api.js` (the client for `/api/*`), plus small helpers (`format.js`, `steps.js`, `files.js`, `citations.js`, `limits.js`). `api.js` and the helpers have unit tests | |
| `apps/web/api/` | Serverless functions: `chat.js` (streams replies from Claude), `conversations.js` (saved chats), `feedback.js` (thumbs up / down) | |
| `apps/web/lib/` | Sign-in checks, attachment checks, rate limiting and chat storage | |
| `packages/agent` | The agent: Langfuse prompts, language and intent checks, titles, redaction, tool access, and the prompt evals (`npm run eval`, `npm run promote`). Shared by every channel | Imported by `apps/web` |
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
| `CRON_SECRET` | Random secret that lets Vercel's daily cron run `/api/cleanup`, which deletes chats inactive for longer than each user's "Delete chats after" setting (7, 30 or 90 days, default 30). Without it, cleanup refuses to run. |
| `MCP_URL` | Optional: the MCP server's address, e.g. `https://<mcp-project>.vercel.app/mcp` |
| `MCP_TOKEN` | Shared secret sent to the MCP server as `Authorization: Bearer <token>`. Must match `MCP_TOKEN` on the `proxi-mcp` project, or the agent gets no tools. |

The system prompt can be edited in Langfuse as a text prompt named `main-system` with the label `production`. Without it, the built-in prompt in `packages/agent/src/langfuse.js` is used.

## Tests

The tests cover redaction, attachment checks (including real PDF parsing) and chat storage, against an in-memory Postgres. Run them from the web app's folder:

```
cd apps/mcp && npm install && npm test
cd ../web && npm install && npm test
```

The web tests include an end-to-end check: the chat endpoint discovers `get_status` from the MCP server, Claude (a scripted stand-in) calls it, and the result is routed back. It needs `npm install` in `apps/mcp` first.

## MCP server

`apps/mcp` uses the official MCP TypeScript SDK and serves Streamable HTTP at `/mcp`. Its tools:

- `get_status`: returns `{ "status": "ok", "service", "version", "uptimeSeconds", "time" }`
- `search_docs`: searches the help center pages (`apps/docs`) with a keyword search that runs inside the MCP server, and returns matching passages with their title and link. It reads `apps/mcp/lib/docs-index.json`, which you rebuild with `npm run build-docs-index` in `apps/mcp` after changing the docs (a test fails when it is out of date). The chat turns them into citations: numbered links in the reply and a **Sources** list.
- `web_search`: asks Claude (Sonnet 5.5) with Anthropic's web search tool on, and returns a short answer plus the cited pages as citable results.
- `send_escalation_email`: emails Lisandro a summary of what someone needs through Resend, with the address they typed as Reply-To. Only the web app calls it, when someone presses Send on the "Message Lisandro" card (`POST /api/contact`). The web app never offers it to the model, so the address doesn't reach the model. The card itself comes from `offer_message_to_lisandro`, a tool the web app offers the model once someone in the chat asked for a person (`apps/web/lib/contact.js`).

MCP server environment variables (set in the `proxi-mcp` Vercel project):

| Name | Purpose |
|---|---|
| `MCP_TOKEN` | Shared secret every request must send as `Authorization: Bearer <token>`. Generate one with `openssl rand -base64 32` and set the same value on the web app. Without it, the server refuses every request (503). |
| `ANTHROPIC_API_KEY` | Claude API key, used by `web_search`. Without it, `web_search` isn't offered to the agent |
| `MINTLIFY_DOCS_URL` | Optional: base URL for citation links. Defaults to `https://proxi.mintlify.app` |
| `RESEND_API_KEY` | Resend API key, used by `send_escalation_email`. Without it (or `SUPPORT_EMAIL_TO`), the tool isn't offered and the card isn't shown |
| `SUPPORT_EMAIL_TO` | Where escalation emails go. Without a verified domain in Resend, this must be the address the Resend account was created with |
| `RESEND_FROM` | Optional: the sender, once a domain is verified in Resend. Defaults to `Proxi <onboarding@resend.dev>` |

Run it locally:

```
cd apps/mcp
npm install
MCP_TOKEN=dev-token npm start
```

It listens on `http://localhost:3001/mcp` (set `PORT` to change it). To try it by hand:

```
curl -s http://localhost:3001/mcp -H 'authorization: Bearer dev-token' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Or open it in the MCP Inspector with `npx @modelcontextprotocol/inspector` (add the bearer token in its authentication settings). To use it from the chat locally, set `MCP_URL=http://localhost:3001/mcp` and `MCP_TOKEN=dev-token` for the web app.

Every request needs the bearer token, checked in `apps/mcp/lib/server.js`. It's one shared secret for the whole web app, not a per-user sign-in, so tools must not trust it to identify a user.

## Docs

Preview the help center locally with the Mintlify CLI:

```
cd apps/docs
npx mintlify dev
```
