import { array, record, text } from './server.js';
import type { ChatItem } from '../../../repositories/sessionItems.js';

export function openCodeHistoryItems(raw: unknown): ChatItem[] {
  const message = record(raw),
    id = text(message.id);
  if (!id) return [];
  if (message.type === 'user')
    return [
      {
        id,
        turnId: id,
        type: 'userMessage',
        role: 'user',
        title: 'You',
        text: text(message.text),
        status: 'completed',
      },
    ];
  if (message.type !== 'assistant') return [];
  const status = message.error
    ? 'failed'
    : record(message.time).completed
      ? 'completed'
      : 'inProgress';
  const content = array(message.content).map(record);
  const items: ChatItem[] = [];
  for (const reasoning of [false, true]) {
    const parts = content.filter(
      (part) => part.type === (reasoning ? 'reasoning' : 'text'),
    );
    if (parts.length)
      items.push({
        id: id + (reasoning ? '-reasoning' : ''),
        turnId: id,
        type: reasoning ? 'reasoning' : 'agentMessage',
        role: reasoning ? 'activity' : 'assistant',
        title: reasoning ? 'Reasoning' : 'OpenCode',
        text: parts.map((part) => text(part.text)).join(''),
        status,
      });
  }
  for (const tool of content.filter((part) => part.type === 'tool')) {
    const state = record(tool.state);
    items.push({
      id: `${id}-${text(tool.id)}`,
      turnId: id,
      type: tool.name === 'shell' ? 'commandExecution' : 'tool',
      role: 'activity',
      title: text(record(state.input).command) || text(tool.name) || 'Tool',
      text:
        array(state.content)
          .map(record)
          .map((part) => text(part.text))
          .join('\n') ||
        text(record(state.error).message) ||
        JSON.stringify(state.input ?? {}),
      status:
        state.status === 'completed'
          ? 'completed'
          : state.status === 'error'
            ? 'failed'
            : 'inProgress',
    });
  }
  return items;
}
