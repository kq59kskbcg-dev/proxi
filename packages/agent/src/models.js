// The Claude models Proxi uses, in one place. The browser can't import this file, so
// apps/web/ui/format.js keeps its own copy of the labels, and apps/mcp keeps its own search
// model; tests check that both match.

export const OPUS = 'claude-opus-5-5';
export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';

// The models people can pick in the chat, with the names shown for them.
export const MODEL_LABELS = { [OPUS]: 'Opus 5.5', [SONNET]: 'Sonnet 5.5', [HAIKU]: 'Haiku 5.5' };
// The same, by label: the browser sends the label of the model it wants.
export const SELECTABLE_MODELS = Object.fromEntries(Object.entries(MODEL_LABELS).map(([id, label]) => [label, id]));

// Models that support server-side refusal fallbacks (Haiku does not).
export const FALLBACK_MODELS = new Set([OPUS, SONNET]);

// The small model for titles, summaries and the classifiers (language, escalation, routing).
export const CLASSIFIER_MODEL = HAIKU;

// The model for each level of the Auto routing classifier.
export const ROUTE_MODELS = { simple: HAIKU, standard: SONNET, complex: OPUS };

// The model that runs web searches in apps/mcp, and the model that judges evals.
export const SEARCH_MODEL = SONNET;
export const JUDGE_MODEL = SONNET;
