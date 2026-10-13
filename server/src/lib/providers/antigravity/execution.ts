import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { ChatSettings } from '../types.js';

export type AntigravityOptions = {
  cwd: string;
  prompt: string;
  instructions: string | null;
  conversationId?: string | null;
  settings: ChatSettings;
};
export function executeAntigravity(
  options: AntigravityOptions,
  onEvent: (event: Record<string, unknown>) => void,
  onDiagnostic: (text: string) => void,
) {
  if (options.settings.permissions === 'read-only')
    throw Error('Antigravity does not expose a read-only file sandbox.');
  const args = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--mode',
    options.settings.mode === 'plan' ? 'plan' : 'accept-edits',
  ];
  if (options.settings.approvalPolicy === 'never')
    args.push('--dangerously-skip-permissions');
  if (options.conversationId)
    args.push('--conversation', options.conversationId);
  if (options.settings.model) args.push('--model', options.settings.model);
  if (options.settings.effort) args.push('--effort', options.settings.effort);
  const child = spawn('agy', args, {
    cwd: options.cwd,
    env: process.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let oversized = false;
  const consume = (chunk: string) => {
    for (const part of chunk.split(/(?<=\n)/)) {
      if (!oversized) pending += part;
      if (pending.length > 2 * 1024 * 1024) {
        onDiagnostic('[Antigravity event exceeded the size limit]\n');
        pending = '';
        oversized = true;
      }
      if (part.endsWith('\n')) {
        if (!oversized && pending.trim()) {
          try {
            const event: unknown = JSON.parse(pending);
            if (event && typeof event === 'object' && !Array.isArray(event))
              onEvent(event as Record<string, unknown>);
          } catch {
            onDiagnostic(pending.slice(0, 65536));
          }
        }
        pending = '';
        oversized = false;
      }
    }
  };
  child.stdout.on('data', (chunk: Buffer) => consume(decoder.write(chunk)));
  child.stdout.on('end', () => {
    consume(decoder.end());
    if (pending && !oversized) consume('\n');
  });
  const diagnostics = new StringDecoder('utf8');
  child.stderr.on('data', (chunk: Buffer) =>
    onDiagnostic(diagnostics.write(chunk)),
  );
  child.stderr.on('end', () => {
    const tail = diagnostics.end();
    if (tail) onDiagnostic(tail);
  });
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') onDiagnostic(error.message);
  });
  // AGY expands slash skills at the start of the input. Keep that position when
  // adding role context; no skill bodies are manually injected.
  const content = options.instructions
    ? options.prompt.startsWith('/')
      ? `${options.prompt}\n\nAgent instructions:\n${options.instructions}`
      : `Agent instructions:\n${options.instructions}\n\nUser message:\n${options.prompt}`
    : options.prompt;
  child.stdin.end(
    JSON.stringify({ event: 'user', message: { content } }) + '\n',
  );
  return child;
}
