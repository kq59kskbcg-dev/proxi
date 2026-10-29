// Usage: npm run promote -- <prompt name> <version> [--skip-eval]
// Moves the "production" label to that version, but only if its eval passes. A prompt with no eval
// is refused unless --skip-eval is given on purpose.

import Anthropic from '@anthropic-ai/sdk';
import { getLangfuse } from '../src/langfuse.js';
import { DATASETS, evalPrompt, report } from './prompt-evals.js';

const args = process.argv.slice(2);
const skip = args.includes('--skip-eval');
const [name, versionArg] = args.filter((a) => !a.startsWith('--'));
const version = Number(versionArg);
const langfuse = getLangfuse();
if (!name || !Number.isInteger(version) || version < 1) {
  console.error('Usage: npm run promote -- <prompt name> <version> [--skip-eval]');
  process.exit(2);
}
if (!langfuse) {
  console.error('Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY first.');
  process.exit(2);
}
if (DATASETS[name]) {
  const result = await evalPrompt(langfuse, new Anthropic(), name, version);
  console.log(report(result));
  if (!result.ok) {
    console.error('Not promoted: the eval did not pass.');
    process.exit(1);
  }
} else if (!skip) {
  console.error(`Not promoted: "${name}" has no eval. Add one, or pass --skip-eval to promote without it.`);
  process.exit(1);
}
await langfuse.api.promptVersionUpdate(name, version, { newLabels: ['production'] });
console.log(`${name} v${version} is now production.`);
