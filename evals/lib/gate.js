// The pass rule over all scores. items: [{ id, scores: { <judge>: number | null }, pageRetrieved: boolean }].
//
// Hard judges (and the page check): every item must pass; a hard judge needs a score of at least 4.
// Soft judges: the average must be at least 4 and no item may score below 3.

import { JUDGES } from './judges.js';

export const HARD_MIN = 4;
export const SOFT_AVERAGE_MIN = 4;
export const SOFT_ITEM_MIN = 3;

export function evaluateGate(items) {
  const problems = [];
  const averages = {};
  for (const item of items) {
    if (!item.pageRetrieved) problems.push(`${item.id}: the expected page was not among the top 3 search results`);
  }
  for (const [judge, kind] of Object.entries(JUDGES)) {
    const scores = items.map((item) => ({ id: item.id, score: item.scores[judge] ?? null }));
    const known = scores.filter((s) => s.score !== null);
    averages[judge] = known.length ? known.reduce((sum, s) => sum + s.score, 0) / known.length : null;
    for (const s of scores) {
      if (s.score === null) problems.push(`${s.id}: no ${judge} score`);
      else if (kind === 'hard' && s.score < HARD_MIN) problems.push(`${s.id}: ${judge} scored ${s.score} (needs ${HARD_MIN})`);
      else if (kind === 'soft' && s.score < SOFT_ITEM_MIN) problems.push(`${s.id}: ${judge} scored ${s.score} (needs ${SOFT_ITEM_MIN})`);
    }
    if (kind === 'soft' && known.length && averages[judge] < SOFT_AVERAGE_MIN) {
      problems.push(`${judge}: average ${averages[judge].toFixed(2)} is below ${SOFT_AVERAGE_MIN}`);
    }
  }
  return { ok: items.length > 0 && problems.length === 0, problems, averages };
}
