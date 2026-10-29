// Usage: npm run search-docs -w @proxi/evals
//
// Sends each question in the Langfuse dataset "evals/search-docs" through the real chat route,
// with a local MCP server and the real docs search. Every reply is scored by the judges and the
// page check, the scores are saved on the traces in Langfuse, and the gate decides pass or fail.
//
// Needs: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY (and LANGFUSE_BASE_URL outside the EU cloud),
// ANTHROPIC_API_KEY, MINTLIFY_API_KEY, and `npm ci` run in apps/mcp.
// Optional: EVAL_MODEL (chat model, default "Sonnet 5.5"), EVAL_JUDGE_MODEL, EVAL_JUDGE_LABEL
// (label of the judge prompts, default "latest"), EVAL_RUN_NAME.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { getLangfuse } from '@proxi/agent/langfuse';
import { getMcpTools } from '@proxi/agent/mcp';
import { collectEvidence, pageRetrieved } from './lib/evidence.js';
import { JUDGES, JUDGE_MODEL, judgeVariables, runJudge } from './lib/judges.js';
import { evaluateGate } from './lib/gate.js';

const DATASET = 'evals/search-docs';
const mcpDir = fileURLToPath(new URL('../apps/mcp/', import.meta.url));

const missing = ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'ANTHROPIC_API_KEY', 'MINTLIFY_API_KEY'].filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Set ${missing.join(', ')} first.`);
  process.exit(2);
}

const langfuse = getLangfuse();
const client = new Anthropic();
const model = process.env.EVAL_MODEL || 'Sonnet 5.5';
const judgeModel = process.env.EVAL_JUDGE_MODEL || JUDGE_MODEL;
const judgeLabel = process.env.EVAL_JUDGE_LABEL || 'latest';
const runName = process.env.EVAL_RUN_NAME || `search-docs ${new Date().toISOString()}`;

const mcp = await startMcpServer();
let exitCode = 1;
try {
  exitCode = await main();
} finally {
  mcp.kill();
}
process.exit(exitCode);

async function main() {
  // The chat route checks a Clerk token, so the runner signs its own and trusts its own key.
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.CLERK_JWT_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const token = signJwt(keys.privateKey, { sub: 'eval-runner', azp: 'https://localhost' });
  const { POST } = await import('../apps/web/api/chat.js');

  // Every tool call and its result, so the judges can see what the agent found.
  const toolLog = [];
  const tools = await getMcpTools();
  if (!tools) throw new Error('The MCP server could not be reached.');
  const call = tools.call;
  tools.call = async (block) => {
    const result = await call(block);
    toolLog.push({ name: block.name, input: block.input, result });
    return result;
  };

  const { data } = await langfuse.api.datasetItemsList({ datasetName: DATASET, limit: 100 });
  const dataset = data.filter((item) => item.status !== 'ARCHIVED');
  if (!dataset.length) throw new Error(`The dataset "${DATASET}" has no active items.`);

  const items = [];
  for (const entry of dataset) {
    const item = { id: entry.id, question: entry.input.question, reference: entry.expectedOutput.reference, page: entry.expectedOutput.page };
    toolLog.length = 0;
    const response = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, host: 'localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: item.question }] }),
    }));
    if (response.status !== 200) throw new Error(`The chat route returned ${response.status} for "${item.question}".`);
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    const evidence = collectEvidence(events, toolLog);
    // A failed docs search comes back as text; show it so the log says why nothing was found.
    for (const call of toolLog) {
      if (call.name !== 'search_docs') continue;
      if (call.result?.is_error) console.log(`${item.id}: search_docs failed: ${JSON.stringify(call.result.content).slice(0, 300)}`);
      else if (!evidence.retrieved.length) console.log(`${item.id}: search_docs found nothing for ${JSON.stringify(call.input)}`);
    }
    const traceId = events.find((e) => e.type === 'start')?.traceId ?? null;

    const scores = {};
    const reasons = {};
    for (const name of Object.keys(JUDGES)) {
      const { score, reason } = evidence.error
        ? { score: null, reason: evidence.error }
        : await runJudge(langfuse, client, name, judgeVariables(item, evidence), { model: judgeModel, label: judgeLabel });
      scores[name] = score;
      reasons[name] = reason;
    }
    const retrieved = pageRetrieved(evidence, item.page);
    items.push({ id: item.id, scores, pageRetrieved: retrieved });

    if (traceId) {
      await langfuse.api.datasetRunItemsCreate({ runName, datasetItemId: entry.id, traceId });
      for (const [name, score] of Object.entries(scores)) {
        if (score !== null) langfuse.score({ traceId, name, value: score, comment: reasons[name], dataType: 'NUMERIC' });
      }
      langfuse.score({ traceId, name: 'page-retrieved', value: retrieved ? 1 : 0, dataType: 'NUMERIC' });
    }
    console.log(`${item.id}: ${retrieved ? 'page found' : 'PAGE MISSED'}; ${Object.entries(scores).map(([n, s]) => `${n} ${s ?? '-'}`).join(', ')}`);
  }
  await langfuse.flushAsync();

  const gate = evaluateGate(items);
  console.log(`\nRun "${runName}" on ${DATASET}`);
  for (const [name, average] of Object.entries(gate.averages)) console.log(`  ${name} (${JUDGES[name]}): average ${average === null ? '-' : average.toFixed(2)}`);
  for (const problem of gate.problems) console.log(`  FAIL ${problem}`);
  console.log(gate.ok ? 'Gate passed.' : 'Gate failed.');
  return gate.ok ? 0 : 1;
}

async function startMcpServer() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: mcpDir, env: { ...process.env, PORT: String(port) } });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('localhost')) resolve(); });
    child.on('exit', () => reject(new Error('The MCP server stopped. Did you run `npm ci` in apps/mcp?')));
  });
  process.env.MCP_URL = `http://127.0.0.1:${port}/mcp`;
  return child;
}

function signJwt(privateKey, claims) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now, nbf: now - 5, exp: now + 600, ...claims })}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')}`;
}
