// Usage: npm run eval -- <prompt name> <version>
// Needs LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY (and LANGFUSE_BASE_URL if not the EU cloud) and ANTHROPIC_API_KEY.

import Anthropic from '@anthropic-ai/sdk';
import { getLangfuse } from '../lib/langfuse.js';
import { evalPrompt, report } from './prompt-evals.js';

const [name, versionArg] = process.argv.slice(2);
const version = Number(versionArg);
const langfuse = getLangfuse();
if (!name || !Number.isInteger(version) || version < 1) {
  console.error('Usage: npm run eval -- <prompt name> <version>');
  process.exit(2);
}
if (!langfuse) {
  console.error('Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY first.');
  process.exit(2);
}
const result = await evalPrompt(langfuse, new Anthropic(), name, version);
console.log(report(result));
process.exit(result.ok ? 0 : 1);
