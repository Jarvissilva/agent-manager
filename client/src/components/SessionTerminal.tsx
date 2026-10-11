import { Button } from '@/components/ui/button';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useRevalidator } from 'react-router';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
export default function SessionTerminal({ sessionId }: { sessionId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState('connecting');
  const [attempt, setAttempt] = useState(0);
  const revalidator = useRevalidator();
  const sessionExited = useEffectEvent(() => void revalidator.revalidate());
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    const terminal = new Terminal({
      fontSize: 14,
      scrollback: 2000,
      disableStdin: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      theme: {
        background: '#171717',
        foreground: '#ececec',
        cursor: '#ececec',
        selectionBackground: '#424242',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    const url = new URL(
      `/api/sessions/${sessionId}/terminal`,
      window.location.href,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    const resize = () => {
      if (!container.current?.clientWidth || !container.current.clientHeight)
        return;
      fit.fit();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'input', data }));
    });
    socket.onopen = () => {
      if (disposed) return;
      resize();
      terminal.focus();
    };
    socket.onmessage = (event) => {
      if (disposed) return;
      const message = JSON.parse(event.data) as {
        type: string;
        data?: string;
        session?: {
          status: 'running' | 'stopping' | 'exited';
        };
      };
      if (typeof message.data === 'string') terminal.write(message.data);
      if (message.session) {
        terminal.options.disableStdin = message.session.status !== 'running';
        setConnection(
          message.session.status === 'running'
            ? 'connected'
            : message.session.status,
        );
      }
      if (
        message.type === 'exit' ||
        (message.type === 'snapshot' && message.session?.status === 'exited')
      )
        sessionExited();
    };
    socket.onclose = () => {
      if (disposed) return;
      terminal.options.disableStdin = true;
      setConnection((state) => (state === 'exited' ? state : 'disconnected'));
    };
    socket.onerror = () => socket.close();
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      socket.close();
      terminal.dispose();
    };
  }, [sessionId, attempt]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span role="status">{connection}</span>
        {connection === 'disconnected' && (
          <Button
            type="button"
            onClick={() => {
              setConnection('connecting');
              setAttempt((value) => value + 1);
            }}
          >
            Reconnect
          </Button>
        )}
      </div>
      <div
        className="min-h-0 w-full flex-1 overflow-hidden rounded-xl border bg-[#171717] p-2"
        ref={container}
        aria-label="Codex terminal"
      />
    </div>
  );
}
