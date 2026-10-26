# Proxi

AI chat assistant built on Claude, deployed on Vercel.

- `index.html`: the app (Vue 3 from a CDN, no build step).
- `api/chat.js`: streams replies from Claude. Card numbers, IBANs, emails and phone numbers are masked before anything reaches the model or the logs.
- `api/feedback.js`: thumbs up / down, stored as Langfuse scores.
- `lib/`: redaction, rate limiting and Langfuse setup.

## Environment variables (set in Vercel)

| Name | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Optional: tracing, prompts and feedback in Langfuse |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` (EU) |

The system prompt can be edited in Langfuse as a text prompt named `proxi-system` with the label `production`. Without it, the built-in prompt in `lib/langfuse.js` is used.

## Tests

```
npm install
npm test
```
