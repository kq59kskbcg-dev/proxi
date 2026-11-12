// Short, friendly descriptions of what the agent is doing, shown while a reply
// is being prepared. The live label leaves out the search query to stay quiet;
// the detail shown in the reply's steps keeps it. Known tools get hand-written wording; any other MCP tool
// falls back to its title.

const KNOWN = {
  search_docs: (input) => ({
    label: 'Searching the help center',
    done: 'Searched the help center',
    detail: quoted('Searched the help center', input?.query),
  }),
  web_search: (input) => ({
    label: 'Searching the web',
    done: 'Searched the web',
    detail: quoted('Searched the web', input?.query),
  }),
  search_chats: (input) => ({
    label: 'Searching your chats',
    done: 'Searched your chats',
    detail: quoted('Searched your chats', input?.query),
  }),
  get_status: () => ({ label: "Checking Proxi's status", done: "Checked Proxi's status", detail: "Checked Proxi's status" }),
  save_memory: () => ({ label: 'Suggesting a memory', done: 'Suggested a memory', detail: 'Suggested a memory' }),
};

export function toolActivity(name, title, input) {
  const known = KNOWN[name];
  if (known) return known(input);
  const what = title || name;
  return { label: `Using ${what}`, done: `Used ${what}`, detail: `Used ${what}` };
}

function quoted(text, query) {
  if (typeof query !== 'string' || !query.trim()) return text;
  const q = query.trim().replace(/\s+/g, ' ');
  return `${text} for "${q.length > 50 ? q.slice(0, 50).trim() + '...' : q}"`;
}
