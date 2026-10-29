// The judge prompts live in Langfuse as "evals/<name>". Each one reads some of these variables:
// input, output, reference, context, tool_calls. The runner fills in all of them.

// hard: every item must score at least 4. soft: judged on the average (see gate.js).
export const JUDGES = {
  correctness: 'hard',
  groundedness: 'hard',
  privacy: 'hard',
  'tool-use': 'hard',
  resolution: 'soft',
  completeness: 'soft',
  clarification: 'soft',
  tone: 'soft',
  'context-relevance': 'soft',
  'context-recall': 'soft',
};

export const JUDGE_MODEL = 'claude-sonnet-5-5';

const FORMAT = '\n\nReply with JSON only, in this shape: {"score": <integer 1 to 5>, "reason": "<one sentence>"}';

export function judgeVariables(item, evidence) {
  return {
    input: item.question,
    output: evidence.output,
    reference: item.reference,
    context: evidence.context || '(no documents were retrieved)',
    tool_calls: evidence.toolCalls.length
      ? evidence.toolCalls.map((call) => `${call.name}(${JSON.stringify(call.input)})`).join('\n')
      : '(no tools were called)',
  };
}

// Returns { score, reason }; score is null when the judge's reply can't be read.
export function parseScore(text) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!match) return { score: null, reason: 'The judge did not reply with JSON.' };
  try {
    const { score, reason } = JSON.parse(match[0]);
    const value = Number(score);
    if (!Number.isInteger(value) || value < 1 || value > 5) return { score: null, reason: 'The judge gave an invalid score.' };
    return { score: value, reason: String(reason ?? '') };
  } catch {
    return { score: null, reason: 'The judge did not reply with valid JSON.' };
  }
}

export async function runJudge(langfuse, client, name, variables, { model = JUDGE_MODEL, label = 'latest' } = {}) {
  const prompt = await langfuse.prompt.get(`evals/${name}`, { label, cacheTtlSeconds: 0 });
  const res = await client.messages.create({
    model,
    max_tokens: 300,
    thinking: { type: 'between_tools' }, // Sonnet 5.5's way to turn thinking off; it rejects 'disabled'
    messages: [{ role: 'user', content: prompt.compile(variables) + FORMAT }],
  }, { timeout: 30_000, maxRetries: 1 });
  return parseScore(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}
