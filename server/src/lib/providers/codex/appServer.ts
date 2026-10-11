import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export type RpcMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

// Codex app-server uses newline-delimited JSON-RPC over stdio. It inherits
// the CLI login; no browser credentials or additional API key are involved.
export function createAppServer(
  cwd: string,
  onMessage: (message: RpcMessage) => void,
  onClose: (code: number | null, error?: string) => void,
) {
  const child = spawn(
    'codex',
    ['--no-daemon', 'app-server', '--listen', 'stdio://'],
    {
      cwd,
      env: process.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let nextId = 0;
  let failure: string | undefined;
  let closed = false;
  const pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const send = (message: object) => {
    if (closed || child.stdin.destroyed)
      throw Error('Codex disconnected. Resume the session to continue.');
    child.stdin.write(JSON.stringify(message) + '\n');
  };
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message: RpcMessage;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object') return;
      message = parsed as RpcMessage;
    } catch {
      return;
    }
    if (!message.method && typeof message.id === 'number') {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error)
        request.reject(Error(message.error.message ?? 'Codex request failed.'));
      else request.resolve(message.result ?? {});
    } else if (message.method) onMessage(message);
  });
  // Drain stderr so a verbose CLI cannot block. Do not expose environment or
  // sensitive data through raw startup diagnostics in the browser.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.on('error', (error) => {
    failure = error.message;
  });
  child.on('close', (code) => {
    closed = true;
    lines.close();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        Error(failure ?? 'Codex disconnected. Resume the session to continue.'),
      );
    }
    pending.clear();
    onClose(code, failure);
  });
  return {
    child,
    notify(method: string, params?: object) {
      send({ method, ...(params ? { params } : {}) });
    },
    respond(id: string | number, result: object) {
      send({ id, result });
    },
    reject(id: string | number) {
      send({
        id,
        error: {
          code: -32601,
          message: 'This client does not support this request.',
        },
      });
    },
    request(method: string, params: object): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          // An unanswered turn/start may still have started work. End this
          // process rather than permitting another turn against unknown state.
          child.kill('SIGTERM');
          reject(Error(`Codex did not respond to ${method}.`));
        }, 30000);
        timer.unref();
        pending.set(id, { resolve, reject, timer });
        try {
          send({ id, method, params });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
  };
}
