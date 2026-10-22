import { useState } from 'react';
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { api } from '../lib/api';
import type { Mcp, McpConfig } from '../types/mcp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';

export function mcpsLoader({ request }: LoaderFunctionArgs) {
  return api<Mcp[]>('/mcps', request.signal);
}
export async function mcpsAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = form.get('intent');
  const id = form.get('id');
  try {
    let results: Mcp[] = [];
    if (intent === 'delete') await api(`/mcps/${id}`, request.signal, 'DELETE');
    else if (intent === 'sync')
      results = [
        await api<Mcp>(`/mcps/${id}/sync`, request.signal, 'POST', {}),
      ];
    else if (intent === 'toggle')
      results = [
        await api<Mcp>(`/mcps/${id}`, request.signal, 'PUT', {
          enabled: form.get('enabled') === 'true',
        }),
      ];
    else if (intent === 'import')
      results = await api<Mcp[]>(
        '/mcps/import',
        request.signal,
        'POST',
        JSON.parse(String(form.get('json'))),
      );
    else if (intent === 'save') {
      const config: McpConfig =
        form.get('type') === 'http'
          ? {
              type: 'http',
              url: String(form.get('url')),
              headers: JSON.parse(String(form.get('headers') || '{}')),
            }
          : {
              type: 'stdio',
              command: String(form.get('command')),
              args: JSON.parse(String(form.get('args') || '[]')),
              env: JSON.parse(String(form.get('env') || '{}')),
              cwd: String(form.get('cwd') || ''),
            };
      results = [
        await api<Mcp>(
          id ? `/mcps/${id}` : '/mcps',
          request.signal,
          id ? 'PUT' : 'POST',
          {
            name: form.get('name'),
            config,
            enabled: form.get('enabled') === 'on',
          },
        ),
      ];
    } else return { error: 'Choose a valid MCP action.' };
    if (
      results.some((result) =>
        result.publications.some((publication) => publication.error),
      )
    )
      return {
        error:
          'Saved, but some providers could not be updated. Review the publication errors below.',
      };
    return redirect('/mcps');
  } catch (error) {
    return {
      error:
        error instanceof SyntaxError
          ? 'Enter valid JSON.'
          : error instanceof Error
            ? error.message
            : 'Could not save MCP server.',
    };
  }
}

function McpEditor({
  mcp,
  busy,
  close,
}: {
  mcp?: Mcp;
  busy: boolean;
  close: () => void;
}) {
  const [mode, setMode] = useState<'fields' | 'json'>('fields');
  const [type, setType] = useState(mcp?.config.type ?? 'stdio');
  const local = mcp?.config.type === 'stdio' ? mcp.config : undefined;
  const remote = mcp?.config.type === 'http' ? mcp.config : undefined;
  return (
    <section className="rounded-2xl border bg-card/40 p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {mcp ? `Edit ${mcp.name}` : 'Add MCP'}
        </h2>
        <Button variant="ghost" type="button" onClick={close}>
          Close
        </Button>
      </div>
      {!mcp && (
        <div className="mb-5 flex gap-2">
          <Button
            type="button"
            variant={mode === 'fields' ? 'default' : 'outline'}
            onClick={() => setMode('fields')}
          >
            Fields
          </Button>
          <Button
            type="button"
            variant={mode === 'json' ? 'default' : 'outline'}
            onClick={() => setMode('json')}
          >
            Import JSON
          </Button>
        </div>
      )}
      <Form method="post" className="grid gap-4" key={mode}>
        <input
          type="hidden"
          name="intent"
          value={mode === 'json' ? 'import' : 'save'}
        />
        {mcp && <input type="hidden" name="id" value={mcp.id} />}
        {mode === 'json' ? (
          <>
            <Label htmlFor="mcp-json">MCP configuration JSON</Label>
            <Textarea
              id="mcp-json"
              name="json"
              required
              rows={12}
              className="font-mono text-xs"
              placeholder={
                '{\n  "mcpServers": {\n    "example": {\n      "command": "npx",\n      "args": ["-y", "your-mcp-package"]\n    }\n  }\n}'
              }
            />
            <p className="text-sm text-muted-foreground">
              Import an mcpServers object, an OpenCode mcp object, or a single
              server with name and command or URL. Multiple servers are
              supported. Unsupported options are rejected.
            </p>
          </>
        ) : (
          <>
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              name="name"
              required
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
              title="Use letters, numbers, dots, underscores, or hyphens, starting with a letter or number."
              defaultValue={mcp?.name}
            />
            <Label htmlFor="mcp-type">Connection</Label>
            <NativeSelect
              id="mcp-type"
              name="type"
              value={type}
              onChange={(event) =>
                setType(event.target.value === 'http' ? 'http' : 'stdio')
              }
            >
              <option value="stdio">Local command (stdio)</option>
              <option value="http">Remote URL (HTTP)</option>
            </NativeSelect>
            {type === 'stdio' ? (
              <>
                <Label htmlFor="mcp-command">Executable</Label>
                <Input
                  id="mcp-command"
                  name="command"
                  required
                  defaultValue={local?.command}
                  placeholder="npx"
                />
                <Label htmlFor="mcp-args">Arguments (JSON array)</Label>
                <Textarea
                  id="mcp-args"
                  name="args"
                  rows={2}
                  defaultValue={JSON.stringify(local?.args ?? [], null, 2)}
                  className="font-mono text-xs"
                />
                <Label htmlFor="mcp-cwd">
                  Working directory (optional absolute path)
                </Label>
                <Input
                  id="mcp-cwd"
                  name="cwd"
                  defaultValue={local?.cwd}
                  placeholder="Inherit the session working directory"
                />
                <Label htmlFor="mcp-env">
                  Environment variables (JSON object)
                </Label>
                <Textarea
                  id="mcp-env"
                  name="env"
                  rows={3}
                  defaultValue={JSON.stringify(local?.env ?? {}, null, 2)}
                  className="font-mono text-xs"
                  placeholder={'{"API_KEY": "your-key"}'}
                  autoComplete="off"
                />
              </>
            ) : (
              <>
                <Label htmlFor="mcp-url">Server URL</Label>
                <Input
                  id="mcp-url"
                  name="url"
                  required
                  type="url"
                  defaultValue={remote?.url}
                  placeholder="https://example.com/mcp"
                />
                <Label htmlFor="mcp-headers">Headers (JSON object)</Label>
                <Textarea
                  id="mcp-headers"
                  name="headers"
                  rows={3}
                  defaultValue={JSON.stringify(remote?.headers ?? {}, null, 2)}
                  className="font-mono text-xs"
                  placeholder={'{"Authorization": "Bearer your-token"}'}
                  autoComplete="off"
                />
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Saved environment values and headers are hidden. Keep null to
              preserve a saved value, enter a string to replace it, or remove
              its key to delete it. Keep credentials out of command arguments.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={mcp?.enabled ?? true}
              />{' '}
              Enabled in published provider configurations
            </label>
          </>
        )}
        <Button disabled={busy} type="submit" className="justify-self-start">
          {busy
            ? 'Saving…'
            : mode === 'json'
              ? 'Import and publish'
              : 'Save and publish'}
        </Button>
      </Form>
    </section>
  );
}

export default function Mcps() {
  const mcps = useLoaderData<typeof mcpsLoader>();
  const action = useActionData<typeof mcpsAction>();
  const navigation = useNavigation();
  const location = useLocation();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const busy = navigation.state !== 'idle';
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-3 py-5 sm:px-4 lg:py-6">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">MCPs</h1>
          <Button onClick={() => setEditing('new')}>Add MCP</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage shared tools for Codex, Antigravity, and OpenCode. Published
          servers are available to normal CLI sessions too. Start a new session
          to pick up configuration changes.
        </p>
      </header>
      {action?.error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive p-3 text-sm text-destructive"
        >
          {action.error}
        </p>
      )}
      {editing !== null && (
        <McpEditor
          key={`${location.key}-${editing}`}
          mcp={mcps.find((mcp) => mcp.id === editing)}
          busy={busy}
          close={() => setEditing(null)}
        />
      )}
      {!mcps.length && (
        <p className="rounded-2xl border p-6 text-sm text-muted-foreground">
          No MCP servers yet. Add a command or URL, or import your MCP JSON
          configuration.
        </p>
      )}
      <ul className="grid gap-4">
        {mcps.map((mcp) => (
          <li
            key={mcp.id}
            className="space-y-4 rounded-2xl border bg-card/40 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{mcp.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {mcp.config.type === 'stdio'
                    ? 'Local command'
                    : 'Remote HTTP'}{' '}
                  · {mcp.enabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditing(mcp.id)}
                >
                  Edit
                </Button>
                <Form method="post">
                  <input type="hidden" name="id" value={mcp.id} />
                  <input type="hidden" name="intent" value="toggle" />
                  <input
                    type="hidden"
                    name="enabled"
                    value={String(!mcp.enabled)}
                  />
                  <Button variant="outline" disabled={busy}>
                    {mcp.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="id" value={mcp.id} />
                  <Button
                    variant="outline"
                    name="intent"
                    value="sync"
                    disabled={busy}
                  >
                    Sync
                  </Button>
                </Form>
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (
                      !window.confirm(
                        `Delete ${mcp.name} and remove its managed entries from all providers?`,
                      )
                    )
                      event.preventDefault();
                  }}
                >
                  <input type="hidden" name="id" value={mcp.id} />
                  <Button
                    variant="destructive"
                    name="intent"
                    value="delete"
                    disabled={busy}
                  >
                    Delete
                  </Button>
                </Form>
              </div>
            </div>
            <p className="font-mono text-xs break-all text-muted-foreground">
              {mcp.nativeName}
            </p>
            {mcp.previousNativeName && (
              <p role="status" className="text-sm text-muted-foreground">
                Renamed from {mcp.previousNativeName}. Start new sessions and
                sign in again for OAuth connections that used the old name.
              </p>
            )}
            <ul className="space-y-2 text-sm">
              {mcp.publications.map((publication) => (
                <li key={publication.provider}>
                  <span className="capitalize">{publication.provider}</span>:{' '}
                  {publication.status}
                  {publication.error && (
                    <p role="alert" className="text-xs text-destructive">
                      {publication.error}
                    </p>
                  )}
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    {publication.path}
                  </p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
