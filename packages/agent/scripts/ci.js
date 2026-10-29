// Usage: npm run eval:ci
// Runs the agent's code with the production prompts over every eval dataset. Used by CI on
// changes to the agent. Needs the same environment variables as `npm run eval`.

import Anthropic from '@anthropic-ai/sdk';
import { getLangfuse } from '../src/langfuse.js';
import { DATASETS, evalLive, report } from './prompt-evals.js';

const langfuse = getLangfuse();
if (!langfuse || !process.env.ANTHROPIC_API_KEY) {
  console.error('Set LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and ANTHROPIC_API_KEY first.');
  process.exit(2);
}
const client = new Anthropic();
let ok = true;
for (const name of Object.keys(DATASETS)) {
  const result = await evalLive(langfuse, client, name);
  console.log(report(result));
  ok &&= result.ok;
}
process.exit(ok ? 0 : 1);
