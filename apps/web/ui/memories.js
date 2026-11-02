// Memory: facts Proxi saved to remember. Shown in Settings, where each one can be deleted.

import { api } from './api.js';

export const memoriesState = {
  memories: null // null until loaded
};

export function createMemories(app) {
  const s = app.state;

  async function loadMemories() {
    try {
      app.setState({ memories: (await api.get('/api/memories')).memories || [] });
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
        noMemories: Array.isArray(s.memories) && s.memories.length === 0
      })
    }
  };
}
