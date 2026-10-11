import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { ChevronDown, Brain, ShieldCheck } from 'lucide-react';
import Icon from './Icon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { ChatSettings, ProviderModel } from '../types/chat';
import type { Skill } from '../types/skill';
import type { Agent } from '../types/agent';

export default function ChatComposer({
  sessionId,
  workingDirectory,
  projectId,
  provider = 'codex',
  onProviderChange,
  intent = 'message',
  initialSettings,
  models,
  agents = [],
  disabled = false,
  working = false,
  stopping = false,
  connected = true,
  onSend,
}: {
  sessionId?: string;
  workingDirectory?: string;
  projectId?: number | null;
  provider?: Agent['provider'];
  onProviderChange?: (provider: Agent['provider']) => void;
  intent?: 'message' | 'new-message' | 'continue';
  initialSettings?: ChatSettings;
  models: ProviderModel[];
  agents?: Agent[];
  disabled?: boolean;
  working?: boolean;
  stopping?: boolean;
  connected?: boolean;
  onSend?: () => void;
}) {
  const [settings, setSettings] = useState<ChatSettings>(
    initialSettings ?? {
      model: null,
      effort: null,
      permissions: 'workspace-write',
    },
  );
  const [settingsProvider, setSettingsProvider] = useState(provider);
  const [settingsDirectory, setSettingsDirectory] = useState(workingDirectory);
  const [agentId, setAgentId] = useState('');
  const [draft, setDraft] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillError, setSkillError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/skills', { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('Could not load skills.');
        setSkills(await response.json());
      })
      .catch(() => {
        if (!abort.signal.aborted) setSkillError('Could not load skills.');
      });
    return () => abort.abort();
  }, []);
  const skillMarker =
    provider === 'opencode' ? '@' : provider === 'antigravity' ? '/' : '$';
  const skillQuery =
    provider === 'codex' ? /(?:^|\s)\$([a-z0-9-]*)$/.exec(draft) : null;
  const suggestions = skillQuery
    ? skills
        .filter(
          (skill) => !skill.error && skill.nativeName.startsWith(skillQuery[1]),
        )
        .slice(0, 6)
    : [];
  function insertSkill(skill: Skill) {
    setDraft((draft) =>
      provider === 'antigravity'
        ? `${skillMarker}${skill.nativeName} ${draft}`
        : skillQuery
          ? draft.replace(/\$[a-z0-9-]*$/, `$${skill.nativeName} `)
          : `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${skillMarker}${skill.nativeName} `,
    );
    composer.current?.focus();
  }
  const [completed, setCompleted] = useState<unknown>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const fetcher = useFetcher<{
    error?: string;
    sent?: boolean;
    sessionId?: string;
  }>();
  const stop = useFetcher<{ error?: string }>();
  if (settingsDirectory !== workingDirectory) {
    setSettingsDirectory(workingDirectory);
    setSettings((previous) => ({ ...previous, model: null, effort: null }));
  }
  if (settingsProvider !== provider) {
    setSettingsProvider(provider);
    setSettings({ model: null, effort: null, permissions: 'workspace-write' });
    setAgentId('');
  }
  if (
    fetcher.state === 'idle' &&
    fetcher.data?.sent &&
    completed !== fetcher.data
  ) {
    setCompleted(fetcher.data);
    if (draft === submitted) setDraft('');
  }
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.sent && composer.current) {
      composer.current.style.height = 'auto';
      composer.current.focus();
    }
  }, [fetcher.state, fetcher.data]);
  const providerName =
    provider === 'opencode'
      ? 'OpenCode'
      : provider === 'antigravity'
        ? 'Antigravity'
        : 'Codex';
  const model =
    models.find((model) => model.model === settings.model) ??
    models.find((model) => model.isDefault);
  const busy = disabled || working || fetcher.state !== 'idle';
  const canSend =
    !disabled &&
    !working &&
    connected &&
    fetcher.state === 'idle' &&
    Boolean(draft.trim()) &&
    (intent !== 'new-message' || Boolean(workingDirectory?.trim()));
  return (
    <div className="composer-dock mx-auto w-full max-w-3xl shrink-0 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
      {(fetcher.data?.error || stop.data?.error) && (
        <p
          role="alert"
          className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {fetcher.data?.error || stop.data?.error}
        </p>
      )}
      <fetcher.Form
        method="post"
        className="chat-composer rounded-[26px] border border-white/5 bg-muted p-2 shadow-sm focus-within:border-white/15"
        onSubmit={(event) => {
          if (!canSend) {
            event.preventDefault();
            return;
          }
          setSubmitted(draft);
          onSend?.();
        }}
      >
        <input type="hidden" name="intent" value={intent} />
        {intent === 'new-message' && (
          <input type="hidden" name="projectId" value={projectId ?? ''} />
        )}
        {intent === 'new-message' && (
          <input
            type="hidden"
            name="workingDirectory"
            value={workingDirectory ?? ''}
          />
        )}
        <input
          type="hidden"
          name="sessionId"
          value={fetcher.data?.sessionId ?? sessionId ?? ''}
        />
        <input type="hidden" name="provider" value={provider} />
        <input type="hidden" name="settings" value={JSON.stringify(settings)} />
        {intent === 'new-message' && (
          <input type="hidden" name="projectId" value={projectId ?? ''} />
        )}
        {intent === 'new-message' && (
          <input type="hidden" name="agentId" value={agentId} />
        )}
        <Textarea
          ref={composer}
          name="prompt"
          aria-label={`Message ${providerName}`}
          placeholder="Ask anything about this project"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          maxLength={100000}
          required
          disabled={disabled}
          className="min-h-16 max-h-48 resize-none rounded-none border-0 bg-transparent px-3 py-3 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-base dark:bg-transparent"
          onInput={(event) => {
            event.currentTarget.style.height = 'auto';
            event.currentTarget.style.height =
              Math.min(event.currentTarget.scrollHeight, 192) + 'px';
          }}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && suggestions.length && !busy) {
              event.preventDefault();
              insertSkill(suggestions[0]);
              return;
            }
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (canSend) event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {!!suggestions.length && !busy && (
          <div
            aria-label="Skill suggestions"
            className="mx-2 mb-2 rounded-xl border bg-popover p-1"
          >
            {suggestions.map((skill) => (
              <button
                key={skill.id}
                type="button"
                className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => insertSkill(skill)}
              >
                <span className="font-medium">${skill.nativeName}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {skill.description}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end justify-between gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-0.5">
            {onProviderChange && !fetcher.data?.sessionId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 gap-1 rounded-full px-2.5 text-xs"
                    aria-label="Provider"
                    disabled={busy}
                  >
                    {providerName}
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-48">
                  <DropdownMenuLabel>Provider</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={provider}
                    onValueChange={(value) =>
                      onProviderChange(value as Agent['provider'])
                    }
                  >
                    {[
                      ['codex', 'Codex'],
                      ['antigravity', 'Antigravity'],
                      ['opencode', 'OpenCode'],
                    ].map(([value, label]) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  aria-label="Skills"
                  className="h-8 rounded-full px-2.5 text-xs"
                >
                  Skills
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="max-h-80 w-72"
              >
                <DropdownMenuLabel>Use a native skill</DropdownMenuLabel>
                {skillError && (
                  <p className="p-2 text-xs text-destructive">{skillError}</p>
                )}
                {!skills.length && !skillError && (
                  <p className="p-2 text-xs text-muted-foreground">
                    Create or import a skill from Skills.
                  </p>
                )}
                {skills.map((skill) => (
                  <DropdownMenuItem
                    key={skill.id}
                    disabled={
                      Boolean(skill.error) ||
                      skill.publications.some(
                        (item) =>
                          item.error &&
                          (provider === 'antigravity'
                            ? item.provider === 'Antigravity'
                            : item.provider !== 'Antigravity'),
                      )
                    }
                    onSelect={() => insertSkill(skill)}
                  >
                    <div>
                      <p>
                        {skillMarker}
                        {skill.nativeName}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {skill.error ?? skill.description}
                      </p>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Model"
                  disabled={busy || !models.length}
                  className="h-8 min-w-0 gap-1 rounded-full px-2.5 text-xs"
                >
                  <span className="max-w-36 truncate sm:max-w-52">
                    {model?.displayName ?? settings.model ?? 'Provider default'}
                  </span>
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="max-h-80 w-64"
              >
                <DropdownMenuLabel>Choose a model</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={settings.model ?? 'default'}
                  onValueChange={(value) => {
                    const selected = models.find(
                      (model) => model.model === value,
                    );
                    setSettings({
                      ...settings,
                      model: selected?.model ?? null,
                      effort: selected?.defaultReasoningEffort || null,
                    });
                  }}
                >
                  <DropdownMenuRadioItem value="default">
                    Provider default
                  </DropdownMenuRadioItem>
                  {models.map((model) => (
                    <DropdownMenuRadioItem key={model.id} value={model.model}>
                      <div className="min-w-0">
                        <p className="truncate">{model.displayName}</p>
                        {model.description && (
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {model.description}
                          </p>
                        )}
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Reasoning"
                  disabled={busy || !model?.supportedReasoningEfforts.length}
                  className="h-8 gap-1 rounded-full px-2 text-xs text-muted-foreground"
                >
                  <Brain className="size-3.5" />
                  <span className="hidden capitalize sm:inline">
                    {settings.effort ?? 'Reasoning'}
                  </span>
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-60">
                <DropdownMenuLabel>
                  {provider === 'opencode'
                    ? 'Model variant'
                    : 'Reasoning level'}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={settings.effort ?? 'default'}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      model: settings.model ?? model?.model ?? null,
                      effort: value === 'default' ? null : value,
                    })
                  }
                >
                  <DropdownMenuRadioItem value="default">
                    Provider default
                  </DropdownMenuRadioItem>
                  {model?.supportedReasoningEfforts.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.reasoningEffort}
                      value={option.reasoningEffort}
                    >
                      <div>
                        <p className="capitalize">{option.reasoningEffort}</p>
                        {option.description && (
                          <p className="text-xs text-muted-foreground">
                            {option.description}
                          </p>
                        )}
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Chat settings"
                  title="Chat settings"
                  disabled={busy}
                  className="size-8 rounded-full text-muted-foreground"
                >
                  <Icon name="settings" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-72">
                <DropdownMenuLabel className="flex items-center gap-2">
                  <ShieldCheck className="size-4" />
                  File access
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={settings.permissions}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      permissions: value as ChatSettings['permissions'],
                    })
                  }
                >
                  <DropdownMenuRadioItem value="workspace-write">
                    Edit project files
                  </DropdownMenuRadioItem>
                  {provider !== 'antigravity' && (
                    <DropdownMenuRadioItem value="read-only">
                      Read files only
                    </DropdownMenuRadioItem>
                  )}
                </DropdownMenuRadioGroup>
                {intent === 'new-message' && !fetcher.data?.sessionId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Agent</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={agentId || 'default'}
                      onValueChange={(value) =>
                        setAgentId(value === 'default' ? '' : value)
                      }
                    >
                      <DropdownMenuRadioItem value="default">
                        Default {providerName}
                      </DropdownMenuRadioItem>
                      {agents
                        .filter((agent) => agent.provider === provider)
                        .map((agent) => (
                          <DropdownMenuRadioItem
                            key={agent.id}
                            value={String(agent.id)}
                          >
                            {agent.name}
                          </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                  </>
                )}
                <DropdownMenuSeparator />
                <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                  {provider === 'opencode'
                    ? settings.permissions === 'read-only'
                      ? 'Tool policy disables edits, commands and subagents. This is not an OS sandbox.'
                      : 'Project edits are allowed. Commands and external tools need approval.'
                    : provider === 'antigravity'
                      ? 'Uses local agy permissions. Configure MCP tools in agy.'
                      : 'Applies to your next message. Commands that need permission ask for approval.'}
                </p>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {working ? (
            <Button
              type="button"
              size="icon"
              className="size-9 rounded-full"
              aria-label="Stop response"
              disabled={stopping || stop.state !== 'idle' || !connected}
              onClick={() => {
                if (sessionId)
                  void stop.submit(
                    { intent: 'interrupt', sessionId },
                    { method: 'post' },
                  );
              }}
            >
              <Icon name="stop" className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="size-9 rounded-full"
              disabled={!canSend}
              aria-label={
                fetcher.state !== 'idle' ? 'Sending message' : 'Send message'
              }
            >
              <Icon name="send" className="size-5" />
            </Button>
          )}
        </div>
      </fetcher.Form>
      <p className="mt-2.5 text-center text-[11px] leading-4 text-muted-foreground">
        {settings.permissions === 'read-only'
          ? 'Read-only access'
          : 'Works in your selected folder'}
        <span className="mx-1.5">·</span>Review important changes
      </p>
    </div>
  );
}
