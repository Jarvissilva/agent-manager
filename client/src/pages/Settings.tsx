import { useState } from 'react';
import {
  Form,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { api } from '../lib/api';
import { useAppSettings } from '../lib/preferences';
import type { AppSettings } from '../types/settings';
import type { Agent } from '../types/agent';
import type { ProviderModel } from '../types/chat';
import type { Session } from '../types/session';
import WorkingDirectoryField from '../components/WorkingDirectoryField';
import OpenCodeModelPicker from '../components/OpenCodeModelPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';

const providers = ['codex', 'antigravity', 'opencode'] as const;
const names = {
  codex: 'Codex',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
};
export async function settingsLoader({ request }: LoaderFunctionArgs) {
  const sessions = await api<Session[]>('/sessions', request.signal);
  const directory =
    new URL(request.url).searchParams.get('workingDirectory') ??
    sessions[0]?.workingDirectory ??
    '';
  const catalogs = await Promise.all(
    providers.map(async (provider) => {
      try {
        return {
          provider,
          models: await api<ProviderModel[]>(
            `/providers/${provider}/models${directory ? `?workingDirectory=${encodeURIComponent(directory)}` : ''}`,
            request.signal,
          ),
          error: null,
        };
      } catch (error) {
        if (request.signal.aborted) throw error;
        return {
          provider,
          models: [] as ProviderModel[],
          error:
            error instanceof Error ? error.message : 'Could not load models.',
        };
      }
    }),
  );
  return {
    directory,
    catalogs,
    paths: [...new Set(sessions.map((s) => s.workingDirectory))],
  };
}
export async function settingsAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const provider = String(form.get('provider') ?? '');
  const patch = provider
    ? {
        providers: {
          [provider]: {
            model: form.get('model') || null,
            effort: form.get('effort') || null,
          },
        },
        workingDirectory: form.get('workingDirectory') || undefined,
      }
    : form.has('timezone')
      ? { timezone: form.get('timezone') }
      : { shortcutsEnabled: form.get('shortcutsEnabled') === 'on' };
  try {
    await api<AppSettings>('/settings', request.signal, 'PATCH', patch);
    return { saved: true, error: null };
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      saved: false,
      error:
        error instanceof Error ? error.message : 'Could not save settings.',
    };
  }
}
function SaveStatus({
  fetcher,
}: {
  fetcher: ReturnType<typeof useFetcher<typeof settingsAction>>;
}) {
  return (
    <>
      {fetcher.data?.error && (
        <p role="alert" className="text-sm text-destructive">
          {fetcher.data.error}
        </p>
      )}
      {fetcher.state === 'idle' && fetcher.data?.saved && (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      )}
    </>
  );
}
function ProviderDefaults({
  provider,
  models,
  error,
  saved,
  directory,
}: {
  provider: Agent['provider'];
  models: ProviderModel[];
  error: string | null;
  saved: AppSettings['providers']['codex'];
  directory: string;
}) {
  const fetcher = useFetcher<typeof settingsAction>();
  const [model, setModel] = useState(saved.model ?? '');
  const [effort, setEffort] = useState(saved.effort ?? '');
  const selected =
    models.find((m) => m.model === model) ??
    (!model ? models.find((m) => m.isDefault) : undefined);
  const efforts = selected?.supportedReasoningEfforts ?? [];
  return (
    <fetcher.Form method="post" className="space-y-4 rounded-2xl border p-4">
      <h2 className="text-lg font-medium">{names[provider]}</h2>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="workingDirectory" value={directory} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${provider}-model`}>Default model</Label>
          {provider === 'opencode' ? (
            <>
              <input type="hidden" name="model" value={model} />
              <OpenCodeModelPicker
                id={`${provider}-model`}
                models={models}
                value={model || null}
                onChange={(value) => {
                  setModel(value ?? '');
                  setEffort(
                    models.find((model) => model.model === value)
                      ?.defaultReasoningEffort || '',
                  );
                }}
              />
            </>
          ) : (
            <NativeSelect
              id={`${provider}-model`}
              name="model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setEffort('');
              }}
            >
              <option value="">Provider default</option>
              {model && !models.some((m) => m.model === model) && (
                <option value={model}>{model} (unavailable)</option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.model}>
                  {m.displayName}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${provider}-effort`}>Default reasoning</Label>
          <NativeSelect
            id={`${provider}-effort`}
            name="effort"
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
          >
            <option value="">Model default</option>
            {effort && !efforts.some((e) => e.reasoningEffort === effort) && (
              <option value={effort}>{effort} (unavailable)</option>
            )}
            {efforts.map((e) => (
              <option key={e.reasoningEffort} value={e.reasoningEffort}>
                {e.reasoningEffort}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <Button disabled={fetcher.state !== 'idle'}>
        Save {names[provider]} defaults
      </Button>
      <SaveStatus fetcher={fetcher} />
    </fetcher.Form>
  );
}
export default function Settings() {
  const settings = useAppSettings();
  const { directory, catalogs, paths } = useLoaderData<typeof settingsLoader>();
  const [folder, setFolder] = useState(directory);
  const [previousDirectory, setPreviousDirectory] = useState(directory);
  if (previousDirectory !== directory) {
    setPreviousDirectory(directory);
    setFolder(directory);
  }
  const timezone = useFetcher<typeof settingsAction>(),
    shortcuts = useFetcher<typeof settingsAction>();
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-3 py-5 sm:px-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Preferences are shared across your devices. Model defaults apply to
          new chats; existing chats and automations keep their settings.
        </p>
      </header>
      <Form method="get" className="space-y-3 rounded-2xl border p-4">
        <WorkingDirectoryField
          value={folder}
          onChange={setFolder}
          suggestions={paths}
        />
        <input type="hidden" name="workingDirectory" value={folder} />
        <p className="text-xs text-muted-foreground">
          OpenCode’s model catalog depends on the working folder.
        </p>
        <Button variant="outline">Load models</Button>
      </Form>
      {catalogs.map((c) => (
        <ProviderDefaults
          key={`${c.provider}:${directory}`}
          {...c}
          saved={settings.providers[c.provider]}
          directory={directory}
        />
      ))}
      <timezone.Form method="post" className="space-y-3 rounded-2xl border p-4">
        <h2 className="text-lg font-medium">Daily reporting</h2>
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          key={settings.timezone}
          id="timezone"
          name="timezone"
          list="timezones"
          defaultValue={settings.timezone}
          required
        />
        <datalist id="timezones">
          {[
            ...new Set([
              'UTC',
              'Asia/Kolkata',
              ...Intl.supportedValuesOf('timeZone'),
            ]),
          ].map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <Button disabled={timezone.state !== 'idle'}>Save timezone</Button>
        <SaveStatus fetcher={timezone} />
      </timezone.Form>
      <shortcuts.Form
        method="post"
        className="space-y-3 rounded-2xl border p-4"
      >
        <h2 className="text-lg font-medium">Keyboard shortcuts</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            key={String(settings.shortcutsEnabled)}
            type="checkbox"
            name="shortcutsEnabled"
            defaultChecked={settings.shortcutsEnabled}
          />
          Enable shortcuts
        </label>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt>Shift+Tab</dt>
          <dd>Toggle Plan in the composer (Codex and Antigravity)</dd>
          <dt>Alt+N</dt>
          <dd>New chat</dd>
          <dt>Alt+/</dt>
          <dd>Focus the composer</dd>
          <dt>Enter / Shift+Enter</dt>
          <dd>Send / new line (always available)</dd>
        </dl>
        <Button disabled={shortcuts.state !== 'idle'}>Save shortcuts</Button>
        <SaveStatus fetcher={shortcuts} />
      </shortcuts.Form>
    </main>
  );
}
