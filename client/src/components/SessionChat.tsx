import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Icon from './Icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import CopyButton from './CopyButton';
import type { ComponentProps } from 'react';
import type {
  ChatItem,
  ChatRequest,
  ChatSnapshot,
  ChatSettings,
  ProviderModel,
} from '../types/chat';
import ChatComposer from './ChatComposer';

function RequestCard({
  request,
  sessionId,
}: {
  request: ChatRequest;
  sessionId: string;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  return (
    <fetcher.Form method="post" className="chat-request space-y-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="requestId" value={request.id} />
      <input type="hidden" name="intent" value="answer" />
      <p className="text-xs font-medium text-muted-foreground">
        Your input is needed
      </p>
      <h3 className="text-base font-medium">{request.title}</h3>
      {request.detail && (
        <pre className="max-h-48 overflow-auto rounded-lg bg-background p-3 text-xs whitespace-pre-wrap break-words">
          {request.detail}
        </pre>
      )}
      {request.questions.map((question) => (
        <label key={question.id} className="block space-y-2 text-sm">
          {question.question}
          {question.options.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {question.options.map((option) => (
                <li key={option.label}>
                  <strong>{option.label}</strong> — {option.description}
                </li>
              ))}
            </ul>
          )}
          {question.inputType === 'multiselect' ? (
            <>
              <input
                type="hidden"
                name={`answer:${question.id}`}
                value={JSON.stringify(selections[question.id] ?? [])}
              />
              <NativeSelect
                className="w-full"
                multiple
                aria-label={question.question}
                required={question.required}
                value={selections[question.id] ?? []}
                onChange={(event) =>
                  setSelections({
                    ...selections,
                    [question.id]: [...event.target.selectedOptions].map(
                      (option) => option.value,
                    ),
                  })
                }
              >
                {question.options.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.description || option.label}
                  </option>
                ))}
              </NativeSelect>
            </>
          ) : question.inputType === 'boolean' ? (
            <NativeSelect
              className="w-full"
              name={`answer:${question.id}`}
              required={question.required}
              defaultValue=""
            >
              <option value="">Choose an answer</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </NativeSelect>
          ) : (
            <Input
              name={`answer:${question.id}`}
              type={
                question.secret
                  ? 'password'
                  : question.inputType === 'number' ||
                      question.inputType === 'integer'
                    ? 'number'
                    : 'text'
              }
              step={question.inputType === 'number' ? 'any' : undefined}
              required={question.required ?? true}
              maxLength={10000}
              placeholder="Type your answer or an option above"
              autoComplete="off"
            />
          )}
        </label>
      ))}
      {fetcher.data?.error && (
        <p role="alert" className="text-sm text-destructive">
          {fetcher.data.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {request.kind === 'approval' ? (
          <>
            <Button
              name="decision"
              value="accept"
              disabled={fetcher.state !== 'idle'}
            >
              Approve once
            </Button>
            <Button
              variant="outline"
              name="decision"
              value="decline"
              disabled={fetcher.state !== 'idle'}
            >
              Decline
            </Button>
          </>
        ) : (
          <>
            <Button disabled={fetcher.state !== 'idle'}>Submit answer</Button>
            {String(request.id).startsWith('frm_') && (
              <Button
                variant="outline"
                name="decision"
                value="decline"
                formNoValidate
                disabled={fetcher.state !== 'idle'}
              >
                Cancel request
              </Button>
            )}
          </>
        )}
      </div>
    </fetcher.Form>
  );
}

function CodeBlock({ children }: ComponentProps<'pre'>) {
  const code = useRef<HTMLPreElement>(null);
  return (
    <div className="my-5 overflow-hidden rounded-xl border bg-sidebar">
      <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-1.5">
        <span className="text-xs text-muted-foreground">Code</span>
        <CopyButton
          text={() => code.current?.textContent ?? ''}
          label="Copy code"
        />
      </div>
      <pre ref={code} className="overflow-x-auto p-4 text-[13px] leading-6">
        {children}
      </pre>
    </div>
  );
}
function Message({ item }: { item: ChatItem }) {
  if (item.role === 'activity')
    return (
      <Collapsible className="mb-3">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            className="group h-auto w-full justify-start gap-2 py-2 text-muted-foreground"
          >
            <Icon
              name={item.type === 'commandExecution' ? 'terminal' : 'activity'}
              className="size-3.5"
            />
            <span className="truncate text-xs">{item.title}</span>
            <span className="ml-auto text-[10px] font-normal">
              {item.status === 'inProgress' ? 'Running' : item.status}
            </span>
            <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-sidebar p-4 font-mono text-xs leading-6 whitespace-pre-wrap break-words">
            {item.text || 'Working…'}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    );
  return (
    <article
      className={`chat-message mb-8 min-w-0 ${item.role === 'user' ? 'user flex flex-col items-end' : 'assistant'}`}
    >
      {item.role === 'user' ? (
        <>
          <span className="sr-only">You</span>
          <div className="chat-user-text max-w-[90%] rounded-3xl bg-muted px-5 py-3 text-[15px] leading-7 whitespace-pre-wrap break-words sm:max-w-[85%]">
            {item.text}
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon name="spark" className="size-4" />
            {item.title}
          </div>
          <div className="chat-markdown">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: CodeBlock,
                a: ({ children, ...props }) => (
                  <a {...props} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {item.text || '…'}
            </Markdown>
          </div>
          {item.text && item.status !== 'inProgress' && (
            <div className="mt-3 -ml-1">
              <CopyButton text={item.text} />
            </div>
          )}
        </>
      )}
      {item.status === 'interrupted' && (
        <span className="mt-2 text-xs text-muted-foreground">
          Response stopped
        </span>
      )}
    </article>
  );
}

export default function SessionChat({
  sessionId,
  active,
  provider = 'codex',
  models = [],
  settings,
  view = 'chat',
  canContinue = false,
  blocked = false,
}: {
  sessionId: string;
  provider?: 'codex' | 'antigravity' | 'opencode';
  active: boolean;
  models?: ProviderModel[];
  settings?: ChatSettings;
  view?: 'chat' | 'terminal';
  canContinue?: boolean;
  blocked?: boolean;
}) {
  const providerName =
    provider === 'opencode'
      ? 'OpenCode'
      : provider === 'antigravity'
        ? 'Antigravity'
        : 'Codex';
  const [snapshot, setSnapshot] = useState<ChatSnapshot>({
    items: [],
    requests: [],
    state: 'starting',
    error: null,
  });
  const [connected, setConnected] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const source = new EventSource(`/api/sessions/${sessionId}/chat`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      const message = JSON.parse(event.data) as ChatSnapshot & {
        type: string;
        item?: ChatItem;
      };
      if (message.type === 'snapshot') {
        setSnapshot(message);
        if (message.state === 'closed') source.close();
      } else if (message.type === 'state') {
        setSnapshot((previous) => ({
          ...previous,
          state: message.state,
          error: message.error,
          requests: message.requests,
          settings: message.settings,
        }));
        if (message.state === 'closed') source.close();
      } else if (message.type === 'item' && message.item) {
        const item = message.item;
        setSnapshot((previous) => ({
          ...previous,
          items: previous.items.some((saved) => saved.id === item.id)
            ? previous.items.map((saved) =>
                saved.id === item.id ? item : saved,
              )
            : [...previous.items, item],
        }));
      }
    };
    return () => source.close();
  }, [sessionId]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [snapshot.items, snapshot.requests, view]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const working = snapshot.state === 'working' || snapshot.state === 'stopping';
  const commands = snapshot.items.filter(
    (item) => item.type === 'commandExecution',
  );
  return (
    <div className="session-chat flex min-h-0 flex-1 flex-col">
      <div
        className="chat-transcript min-h-0 flex-1 overflow-y-auto overscroll-contain"
        ref={scroll}
        onScroll={() => {
          const element = scroll.current;
          if (element)
            follow.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              100;
        }}
        aria-label={view === 'chat' ? 'Conversation' : 'Command output'}
      >
        <div
          className={`chat-transcript-content mx-auto w-full px-3 py-5 sm:px-4 ${view === 'chat' ? 'max-w-3xl' : 'max-w-6xl'}`}
        >
          {view === 'chat' ? (
            <>
              {!snapshot.items.length && (
                <div className="py-20 text-center">
                  <Icon name="spark" className="mx-auto mb-5 size-8" />
                  <h1 className="text-2xl font-medium tracking-tight">
                    What are we working on?
                  </h1>
                </div>
              )}
              {snapshot.items.map((item) => (
                <Message key={item.id} item={item} />
              ))}
              {working && !snapshot.requests.length && (
                <div
                  className="mb-5 flex items-center gap-2.5 text-sm text-muted-foreground"
                  role="status"
                >
                  <span className="size-2 rounded-full bg-foreground/70 animate-pulse motion-reduce:animate-none" />
                  {providerName} is{' '}
                  {snapshot.state === 'stopping' ? 'stopping' : 'working'}…
                </div>
              )}
              {active && !connected && (
                <p role="status" className="mb-5 text-xs text-muted-foreground">
                  Reconnecting to {providerName}…
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mb-5 text-xs text-muted-foreground">
                Command output · Read-only
              </p>
              {commands.length ? (
                commands.map((item) => (
                  <div
                    key={item.id}
                    className="mb-5 overflow-hidden rounded-xl border bg-sidebar"
                  >
                    <div className="border-b px-4 py-3 font-mono text-xs break-words">
                      $ {item.title}
                    </div>
                    <pre className="overflow-auto p-4 font-mono text-xs leading-6 whitespace-pre-wrap break-words">
                      {item.text}
                    </pre>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Commands and their output will appear here.
                </p>
              )}
            </>
          )}
          {snapshot.requests.map((request) => (
            <Card
              key={request.id}
              className="my-5 border-amber-300/20 bg-muted/40"
            >
              <CardContent>
                <RequestCard request={request} sessionId={sessionId} />
              </CardContent>
            </Card>
          ))}
          {snapshot.error && (
            <p
              role="alert"
              className="my-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              {snapshot.error}
            </p>
          )}
        </div>
      </div>
      <ChatComposer
        provider={provider}
        sessionId={sessionId}
        intent={active ? 'message' : 'continue'}
        initialSettings={settings}
        models={models}
        disabled={blocked || (!active && !canContinue)}
        connected={
          canContinue || (connected && snapshot.state === 'idle') || working
        }
        working={working}
        stopping={snapshot.state === 'stopping'}
        onSend={() => {
          follow.current = true;
        }}
      />
    </div>
  );
}
