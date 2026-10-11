import { useEffect, useId, useState } from 'react';
import { useFetcher } from 'react-router';
import type { scheduleLoader } from '../pages/Schedule';
import type { Schedule, ScheduleStep } from '../types/schedule';
import type { Agent } from '../types/agent';
import type { Project } from '../lib/projects';
import WorkingDirectoryField from './WorkingDirectoryField';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';

function newStep(index: number, workingDirectory = ''): ScheduleStep {
  return {
    name: `Session ${index + 1}`,
    workingDirectory,
    agentId: null,
    agentName: null,
    provider: 'codex',
    prompt: '',
    settings: { model: null, effort: null, permissions: 'workspace-write' },
    timeoutMinutes: 30,
  };
}
export default function ScheduleTaskFields({
  schedule,
  projects,
  agents,
  projectId,
  busy,
}: {
  schedule: Schedule | null;
  projects: Project[];
  agents: Agent[];
  projectId: string;
  busy: boolean;
}) {
  const [project, setProject] = useState(projectId);
  const selectedProject = projects.find((p) => String(p.id) === project);
  const [entries, setEntries] = useState(() =>
    (schedule?.steps ?? [newStep(0, selectedProject?.paths[0])]).map(
      (step) => ({
        key: crypto.randomUUID(),
        step,
      }),
    ),
  );
  const move = (index: number, delta: number) =>
    setEntries((old) => {
      const next = [...old];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  return (
    <>
      <Label htmlFor="schedule-project">Project</Label>
      <NativeSelect
        id="schedule-project"
        name="projectId"
        value={project}
        onChange={(event) => setProject(event.target.value)}
        disabled={busy}
      >
        <option value="">No project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </NativeSelect>
      <input
        type="hidden"
        name="steps"
        value={JSON.stringify(entries.map((entry) => entry.step))}
      />
      <div className="mt-4 space-y-4">
        <div>
          <h2 className="font-semibold">Sessions</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Run in order. Each session receives the previous final response. A
            failure stops the remaining sessions.
          </p>
        </div>
        {entries.map((entry, index) => (
          <fieldset
            key={entry.key}
            disabled={busy}
            className="grid gap-3 rounded-xl border p-4"
          >
            <legend className="px-2 text-sm font-medium">
              Session {index + 1}
            </legend>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
              >
                Move up
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || index === entries.length - 1}
                onClick={() => move(index, 1)}
              >
                Move down
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || entries.length === 1}
                onClick={() =>
                  setEntries((old) => old.filter((e) => e.key !== entry.key))
                }
              >
                Remove
              </Button>
            </div>
            <StepFields
              step={entry.step}
              agents={agents}
              paths={
                selectedProject?.paths ?? [
                  ...new Set(projects.flatMap((project) => project.paths)),
                ]
              }
              busy={busy}
              onChange={(step) =>
                setEntries((old) =>
                  old.map((e) => (e.key === entry.key ? { ...e, step } : e)),
                )
              }
            />
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={busy || entries.length >= 20}
          onClick={() =>
            setEntries((old) => [
              ...old,
              {
                key: crypto.randomUUID(),
                step: newStep(old.length, old.at(-1)?.step.workingDirectory),
              },
            ])
          }
        >
          Add session
        </Button>
      </div>
    </>
  );
}
function StepFields({
  step,
  agents,
  paths,
  busy,
  onChange,
}: {
  step: ScheduleStep;
  agents: Agent[];
  paths: string[];
  busy: boolean;
  onChange: (step: ScheduleStep) => void;
}) {
  const id = useId();
  const {
    provider,
    settings: { model: storedModel, effort: storedEffort, permissions },
  } = step;
  const model = storedModel ?? '',
    effort = storedEffort ?? '',
    agent = String(step.agentId ?? '');
  const catalog = useFetcher<typeof scheduleLoader>();
  const load = catalog.load;
  useEffect(() => {
    if (!step.workingDirectory.trim()) return;
    const timer = setTimeout(
      () =>
        void load(
          `/schedules/new?provider=${provider}&workingDirectory=${encodeURIComponent(step.workingDirectory)}&catalog=1`,
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [provider, step.workingDirectory, load]);
  const models =
    catalog.data?.catalogProvider === provider &&
    catalog.data.workingDirectory === step.workingDirectory
      ? catalog.data.models
      : [];
  const selected =
    models.find((m) => m.model === model) ?? models.find((m) => m.isDefault);
  const changeProvider = (provider: ScheduleStep['provider']) =>
    onChange({
      ...step,
      provider,
      settings: {
        model: null,
        effort: null,
        permissions:
          provider === 'antigravity' ? 'workspace-write' : permissions,
      },
    });
  return (
    <>
      <WorkingDirectoryField
        value={step.workingDirectory}
        onChange={(workingDirectory) =>
          onChange({
            ...step,
            workingDirectory,
            settings: { ...step.settings, model: null, effort: null },
          })
        }
        suggestions={paths}
        disabled={busy}
      />
      <Label htmlFor={`${id}-name`}>Name</Label>
      <Input
        id={`${id}-name`}
        required
        maxLength={100}
        value={step.name}
        disabled={busy}
        onChange={(e) => onChange({ ...step, name: e.target.value })}
      />
      <Label htmlFor={`${id}-agent`}>Agent</Label>
      <NativeSelect
        id={`${id}-agent`}

        value={agent}
        onChange={(e) => {
          const a = agents.find((a) => String(a.id) === e.target.value);
          onChange({
            ...step,
            agentId: a?.id ?? null,
            ...(a && a.provider !== provider
              ? {
                  provider: a.provider,
                  settings: {
                    model: null,
                    effort: null,
                    permissions:
                      a.provider === 'antigravity'
                        ? 'workspace-write'
                        : permissions,
                  },
                }
              : {}),
          });
        }}
        disabled={busy}
      >
        <option value="">Provider defaults</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </NativeSelect>
      <Label htmlFor={`${id}-provider`}>Provider</Label>
      <NativeSelect
        id={`${id}-provider`}
        value={provider}
        onChange={(e) =>
          changeProvider(e.target.value as ScheduleStep['provider'])
        }
        disabled={busy || !!agent}
      >
        <option value="codex">Codex</option>
        <option value="antigravity">Antigravity</option>
        <option value="opencode">OpenCode</option>
      </NativeSelect>
      <Label htmlFor={`${id}-prompt`}>Prompt</Label>
      <Textarea
        id={`${id}-prompt`}

        required
        maxLength={20000}
        rows={6}
        value={step.prompt}
        onChange={(e) => onChange({ ...step, prompt: e.target.value })}
        disabled={busy}
        placeholder="What should the agent do?"
      />
      <Label htmlFor={`${id}-model`}>Model</Label>
      <NativeSelect
        id={`${id}-model`}

        value={model}
        disabled={busy}
        onChange={(e) => {
          onChange({
            ...step,
            settings: {
              ...step.settings,
              model: e.target.value || null,
              effort: null,
            },
          });
        }}
      >
        <option value="">Provider default</option>
        {model && !models.some((m) => m.model === model) && (
          <option value={model}>{model}</option>
        )}
        {models.map((m) => (
          <option key={m.id} value={m.model}>
            {m.displayName}
          </option>
        ))}
      </NativeSelect>
      <Label htmlFor={`${id}-effort`}>Reasoning</Label>
      <NativeSelect
        id={`${id}-effort`}

        value={effort}
        onChange={(e) =>
          onChange({
            ...step,
            settings: { ...step.settings, effort: e.target.value || null },
          })
        }
        disabled={busy}
      >
        <option value="">Model default</option>
        {effort &&
          !selected?.supportedReasoningEfforts.some(
            (e) => e.reasoningEffort === effort,
          ) && <option value={effort}>{effort}</option>}
        {selected?.supportedReasoningEfforts.map((e) => (
          <option key={e.reasoningEffort} value={e.reasoningEffort}>
            {e.reasoningEffort}
          </option>
        ))}
      </NativeSelect>
      {catalog.data?.modelError && (
        <p className="text-xs text-muted-foreground">
          {catalog.data.modelError}
        </p>
      )}
      <Label htmlFor={`${id}-permissions`}>File access</Label>
      <NativeSelect
        id={`${id}-permissions`}

        value={permissions}
        onChange={(e) =>
          onChange({
            ...step,
            settings: {
              ...step.settings,
              permissions: e.target.value as typeof permissions,
            },
          })
        }
        disabled={busy}
      >
        <option value="read-only" disabled={provider === 'antigravity'}>
          Read only
        </option>
        <option value="workspace-write">Edit project files</option>
      </NativeSelect>
      <Label htmlFor={`${id}-timeout`}>Timeout (minutes)</Label>
      <Input
        id={`${id}-timeout`}

        type="number"
        min={1}
        max={1440}
        required
        value={step.timeoutMinutes}
        onChange={(e) =>
          onChange({ ...step, timeoutMinutes: Number(e.target.value) })
        }
        disabled={busy}
      />
    </>
  );
}
