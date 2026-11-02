// The streaming tool loop behind a chat reply: stream a response, run the tools it asks for,
// send the results back, and repeat until the model stops asking or `maxRounds` is reached.
// It knows nothing about storage or HTTP: the caller opens each stream and runs each tool.

import { blockCitations, sourcesList } from './citations.js';

// open(turns): starts a streamed model response for these messages (an Anthropic MessageStream).
// executeTool(call): runs one tool_use block and resolves to its tool_result block.
// onEvent(event): { type: 'text', text } for each piece of reply text, and
//   { type: 'tool_calls', calls } before a round's tools run.
// Resolves to { text, final, usage }: the whole reply text, the last model message and the
// tokens used across rounds. Errors (including an aborted stream) are thrown to the caller.
export async function runAgentLoop({ open, messages, toolsEnabled, executeTool, onEvent, maxRounds }) {
  const turns = [...messages];
  const usage = { input: 0, output: 0 };
  const sources = [];
  let text = '';
  // Text from a later round starts a new paragraph.
  let gap = false;
  const emit = (piece) => {
    const chunk = (gap ? '\n\n' : '') + piece;
    gap = false;
    text += chunk;
    onEvent({ type: 'text', text: chunk });
  };
  let final;
  for (let round = 0; ; round++) {
    const stream = open(turns);
    gap = text.length > 0;
    const citations = blockCitations(sources);
    let wrote = false;
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        emit(event.delta.text);
        wrote = true;
      } else if (event.type === 'content_block_delta' && event.delta.type === 'citations_delta') {
        citations.cite(event.delta.citation);
      } else if (event.type === 'content_block_stop') {
        const marker = citations.endBlock(wrote);
        if (marker) emit(' ' + marker);
        wrote = false;
      }
    }
    final = await stream.finalMessage();
    usage.input += final.usage.input_tokens;
    usage.output += final.usage.output_tokens;
    if (final.stop_reason !== 'tool_use' || !toolsEnabled || round + 1 >= maxRounds) break;
    const calls = final.content.filter((block) => block.type === 'tool_use');
    onEvent({ type: 'tool_calls', calls });
    const results = await Promise.all(calls.map((call) => executeTool(call)));
    turns.push({ role: 'assistant', content: final.content }, { role: 'user', content: results });
  }
  const list = sourcesList(sources);
  if (list) emit(list);
  return { text, final, usage };
}
