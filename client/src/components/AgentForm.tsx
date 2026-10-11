import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { Form, Link } from 'react-router';
import type { Agent } from '../types/agent';
import type { Skill } from '../types/skill';
export default function AgentForm({
  agent,
  busy,
  error,
  skills,
}: {
  agent?: Agent;
  busy: boolean;
  error?: string;
  skills: Skill[];
}) {
  const [provider, setProvider] = useState(agent?.provider ?? 'codex');
  return (
    <Form method="post" className="grid gap-3 [&>label:not(:first-child)]:mt-3">
      <Label htmlFor="agent-name" className="grid gap-2 text-sm font-medium">
        Name
      </Label>
      <Input
        id="agent-name"
        name="name"
        required
        maxLength={100}
        defaultValue={agent?.name}
        placeholder="Reviewer"
        disabled={busy}
        className="h-10"
      />
      <Label
        htmlFor="agent-provider"
        className="grid gap-2 text-sm font-medium"
      >
        Provider
      </Label>
      <NativeSelect
        id="agent-provider"
        name="provider"
        value={provider}
        onChange={(event) =>
          setProvider(event.target.value as Agent['provider'])
        }
        disabled={busy}
        className="w-full [&>select]:h-10"
      >
        <option value="codex">Codex</option>
        <option value="antigravity">Antigravity (agy)</option>
        <option value="opencode">OpenCode</option>
      </NativeSelect>
      <p className="text-xs leading-5 text-muted-foreground">
        Choose which local CLI runs this agent.
      </p>
      <Label
        htmlFor="agent-instructions"
        className="grid gap-2 text-sm font-medium"
      >
        Instructions
      </Label>
      <Textarea
        id="agent-instructions"
        name="instructions"
        required
        maxLength={20000}
        rows={10}
        defaultValue={agent?.instructions}
        placeholder="Review code changes, identify bugs, and explain your findings."
        disabled={busy}
        aria-describedby="agent-instructions-help"
        className="min-h-32 resize-y text-sm leading-6"
      />
      <p
        id="agent-instructions-help"
        className="text-xs leading-5 text-muted-foreground"
      >
        Describe the agent’s role and how it should work. Changes apply to new
        sessions.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive break-words"
        >
          {error}
        </p>
      )}
      <fieldset
        disabled={busy}
        className="grid gap-2 rounded-xl border p-4 [&>legend]:px-1 [&>legend]:text-sm [&>legend]:font-medium [&>label]:flex [&>label]:items-center [&>label]:gap-3 [&>label]:rounded-lg [&>label]:bg-muted/40 [&>label]:p-3 [&>label]:font-normal"
      >
        <legend>Skills</legend>
        <p className="text-xs leading-5 text-muted-foreground">
          Selected procedures are included in new sessions.
        </p>
        {skills.length ? (
          skills.map((skill) => (
            <Label key={skill.id} className="grid gap-2 text-sm font-medium">
              <Checkbox
                name="skillIds"
                value={String(skill.id)}
                defaultChecked={agent?.skillIds.includes(skill.id) ?? false}
                className="size-4"
              />
              {skill.name}
            </Label>
          ))
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            No skills yet. <Link to="/skills/new">Create a skill</Link>.
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 pt-3 [&>a]:text-sm [&>a]:text-muted-foreground [&>a:hover]:text-foreground">
        <Button name="intent" value="save" disabled={busy}>
          {busy ? 'Saving…' : agent ? 'Save changes' : 'Create agent'}
        </Button>
        <Link to="/agents">Cancel</Link>
      </div>
    </Form>
  );
}
