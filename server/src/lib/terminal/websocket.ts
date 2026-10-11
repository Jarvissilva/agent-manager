import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { isAllowedOrigin } from '../security/requestOrigin.js';
import { getSessionById } from '../../services/sessions.js';
import type { SessionInfo } from '../../repositories/sessions.js';

export function attachTerminal(server: Server) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const match = /^\/api\/sessions\/([a-f0-9-]+)\/terminal$/.exec(pathname);
    const session = match ? getSessionById(match[1]) : undefined;

    if (!isAllowedOrigin(request) || !session || !session.terminal) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const terminal = session.terminal;

    sockets.handleUpgrade(request, socket, head, (connection) => {
      const send = (message: object) => {
        if (connection.readyState !== WebSocket.OPEN) return;
        if (connection.bufferedAmount > 1024 * 1024) {
          connection.close(1013, 'Reconnect to the terminal');
          return;
        }
        connection.send(JSON.stringify(message));
      };
      const output = (data: string) => send({ type: 'output', data });
      const status = (info: SessionInfo) =>
        send({ type: 'status', session: info });
      const exited = (info: SessionInfo) => {
        send({ type: 'exit', session: info });
        connection.close();
      };

      send({ type: 'snapshot', data: session.output, session: session.info });
      session.events.on('output', output);
      session.events.on('status', status);
      session.events.on('exit', exited);

      connection.on('message', (raw) => {
        if (session.info.status !== 'running') return;
        try {
          const message: unknown = JSON.parse(raw.toString());
          if (
            typeof message !== 'object' ||
            message === null ||
            !('type' in message)
          ) {
            throw new Error('Invalid terminal message');
          }
          if (
            message.type === 'input' &&
            'data' in message &&
            typeof message.data === 'string'
          ) {
            terminal.write(message.data);
          } else if (
            message.type === 'resize' &&
            'cols' in message &&
            'rows' in message &&
            typeof message.cols === 'number' &&
            Number.isInteger(message.cols) &&
            message.cols >= 2 &&
            message.cols <= 500 &&
            typeof message.rows === 'number' &&
            Number.isInteger(message.rows) &&
            message.rows >= 1 &&
            message.rows <= 200
          ) {
            terminal.resize(message.cols, message.rows);
          } else {
            throw new Error('Invalid terminal message');
          }
        } catch {
          connection.close(1008, 'Invalid terminal message');
        }
      });
      connection.on('error', () => connection.close());
      connection.on('close', () => {
        session.events.off('output', output);
        session.events.off('status', status);
        session.events.off('exit', exited);
      });
    });
  });

  return sockets;
}
