// Memory: facts Proxi saved to remember. Shown in Settings with how many are saved out of the limit,
// where each one can be deleted.

import { api } from './api.js';

export const memoriesState = {
  memories: null, // null until loaded
  memoryLimit: 50 // replaced by the limit the server sends
};

export function createMemories(app) {
  const s = app.state;

  async function loadMemories() {
    try {
      const data = await api.get('/api/memories');
      app.setState({ memories: data.memories || [], ...(Number.isInteger(data.limit) ? { memoryLimit: data.limit } : {}) });
    } catch {
      app.setState({ memories: [] });
      app.showToast("Couldn't load your memories. Please try again.");
    }
  }

  async function deleteMemory(id) {
    const before = s.memories || [];
    app.setState({ memories: before.filter((m) => m.id !== id) });
    try {
      await api.delete('/api/memories', { query: { id } });
      app.showToast('Memory deleted');
    } catch {
      app.setState({ memories: before });
      app.showToast("Couldn't delete the memory. Please try again.");
    }
  }

  return {
    actions: { loadMemories },
    views: {
      memories: () => ({
        memoryItems: (s.memories || []).map((m) => ({ key: m.id, text: m.content, remove: () => deleteMemory(m.id) })),
        noMemories: Array.isArray(s.memories) && s.memories.length === 0,
        memoryHint: `Things Proxi remembers about you. ${(s.memories || []).length} of ${s.memoryLimit}.`
      })
    }
  };
}
