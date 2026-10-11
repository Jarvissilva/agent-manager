import { spawn } from 'node:child_process';
import { RequestError } from '../../http/errors.js';

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const text = (value: unknown) =>
  typeof value === 'string' ? value : '';

// Each managed session owns an authenticated, loopback-only OpenCode v2 server.
export class OpenCodeServer {
  readonly child;
  readonly ready: Promise<void>;
  private url = '';
  private authorization = '';
  private ended = false;
  private killTimer?: ReturnType<typeof setTimeout>;
  private readonly abort = new AbortController();
  constructor(cwd: string) {
    this.child = spawn(
      'opencode',
      ['serve', '--hostname', '127.0.0.1', '--port', '0'],
      {
        cwd,
        env: process.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    this.ready = new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => {
        reject(
          new RequestError(
            503,
            'OpenCode did not start. OpenCode v2 is required.',
          ),
        );
        this.close();
      }, 20000);
      const fail = () => {
        clearTimeout(timer);
        reject(
          new RequestError(
            503,
            'Could not start OpenCode. Check that OpenCode v2 is installed.',
          ),
        );
      };
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16384);
        const address = /server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(
          output,
        );
        const password = /server password ([A-Za-z0-9_-]+)(?=\s)/.exec(output);
        if (!address || !password || this.ended) return;
        this.url = address[1];
        this.authorization =
          'Basic ' + Buffer.from('opencode:' + password[1]).toString('base64');
        output = '';
        clearTimeout(timer);
        resolve();
      };
      this.child.stdout.on('data', read);
      this.child.stderr.on('data', read);
      this.child.once('error', fail);
      this.child.once('close', fail);
    });
    this.child.once('close', () => {
      this.ended = true;
      clearTimeout(this.killTimer);
      this.abort.abort();
    });
  }
  async request(path: string, method = 'GET', body?: unknown) {
    await this.ready;
    const response = await fetch(this.url + path, {
      method,
      headers: {
        Authorization: this.authorization,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20000)]),
      redirect: 'error',
    });
    if (!response.ok) {
      const error = record(await response.json().catch(() => ({})));
      throw new RequestError(
        response.status === 404 ? 404 : 502,
        text(error.message) || `OpenCode returned HTTP ${response.status}.`,
      );
    }
    return response.status === 204 ? {} : record(await response.json());
  }
  async events(onEvent: (event: Record<string, unknown>) => void) {
    await this.ready;
    const response = await fetch(this.url + '/api/event', {
      headers: { Authorization: this.authorization },
      signal: this.abort.signal,
      redirect: 'error',
    });
    if (!response.ok || !response.body)
      throw Error('OpenCode event stream unavailable.');
    const decoder = new TextDecoder();
    let pending = '';
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
      if (pending.length > 2 * 1024 * 1024)
        throw Error('OpenCode event exceeded the size limit.');
      let end: number;
      while ((end = pending.indexOf('\n\n')) !== -1) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) onEvent(record(JSON.parse(data)));
      }
    }
    if (!this.ended) throw Error('OpenCode event stream disconnected.');
  }
  close() {
    if (this.ended) return;
    this.ended = true;
    this.abort.abort();
    const signal = (value: NodeJS.Signals) => {
      if (!this.child.pid) return;
      try {
        process.kill(-this.child.pid, value);
      } catch (error) {
        if (record(error).code !== 'ESRCH') throw error;
      }
    };
    signal('SIGTERM');
    this.killTimer = setTimeout(() => signal('SIGKILL'), 2000);
    this.killTimer.unref();
  }
}
