// The "Save to memory" card under a reply: what it shows for each state of its suggestion.
//   pending: the card, with the text editable, Save and Not now
//   saved: "Saved to memory" with the text that was saved
//   declined (Not now, or another message sent without saving): a quiet "Not saved to memory" line

export const MEMORY_MAX = 300; // the same as packages/agent/src/memory.js

export const MEMORY_ERRORS = {
  full: 'Memory is full. Delete a memory in Settings to save this one.',
  invalid: 'Write the memory as one short sentence, up to 300 characters.',
  failed: "Couldn't save. Please try again."
};
export const MEMORY_DUPLICATE = 'This is already in your memories.';

// The page's copy of a chat's messages with any card still waiting marked as declined, because a
// new message is being sent without saving it. The server does the same.
export function declinePending(messages) {
  return messages.map((m) => (m.memory && m.memory.status === 'pending' ? { ...m, memory: { ...m.memory, status: 'declined' } } : m));
}

// Which version of the card to show. form: what's typed in it and whether it's saving.
export function memoryCard(memory, form = {}, busy = false) {
  const status = memory && memory.text ? memory.status : null;
  const draft = form.text != null ? form.text : (memory ? memory.text : '');
  return {
    memoryAsk: status === 'pending',
    memorySaved: status === 'saved',
    memoryDeclined: status === 'declined',
    memoryText: status === 'pending' ? draft : (memory ? memory.text : ''),
    memoryDone: form.duplicate ? MEMORY_DUPLICATE : (memory ? memory.text : ''),
    memoryError: form.error || '',
    memoryBusy: !!form.saving || busy,
    memorySaveLabel: form.saving ? 'Saving...' : 'Save'
  };
}
