import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Form, Link } from 'react-router';
import type { Skill } from '../types/skill';
export default function SkillForm({
  skill,
  busy,
  error,
}: {
  skill?: Skill;
  busy: boolean;
  error?: string;
}) {
  const readOnly = skill?.source === 'imported';
  return (
    <Form method="post" className="grid gap-3 [&>label:not(:first-child)]:mt-3">
      <Label htmlFor="skill-name" className="grid gap-2 text-sm font-medium">
        Name
      </Label>
      <Input
        id="skill-name"
        name="name"
        required
        maxLength={100}
        defaultValue={skill?.name}
        placeholder="Code review"
        disabled={busy}
        readOnly={readOnly}
        className="h-10"
      />
      <Label htmlFor="skill-native-name">Native name</Label>
      <Input
        id="skill-native-name"
        name="nativeName"
        required
        maxLength={64}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        placeholder="code-review"
        defaultValue={skill?.nativeName}
        readOnly={Boolean(skill)}
        disabled={busy}
      />
      <p className="text-xs text-muted-foreground">
        Permanent name used to invoke this skill.
      </p>
      <Label htmlFor="skill-description">When to use</Label>
      <Textarea
        id="skill-description"
        name="description"
        required
        maxLength={1024}
        defaultValue={skill?.description}
        readOnly={readOnly}
        disabled={busy}
        rows={2}
        placeholder="Review code changes for bugs and security issues. Use when reviewing a pull request."
      />
      <Label
        htmlFor="skill-instructions"
        className="grid gap-2 text-sm font-medium"
      >
        Instructions
      </Label>
      <Textarea
        id="skill-instructions"
        name="instructions"
        required
        maxLength={20000}
        rows={10}
        defaultValue={skill?.instructions}
        placeholder="Review code changes, identify bugs, and explain your findings."
        disabled={busy}
        readOnly={readOnly}
        aria-describedby="skill-instructions-help"
        className="min-h-32 resize-y text-sm leading-6"
      />
      <p
        id="skill-instructions-help"
        className="text-xs leading-5 text-muted-foreground"
      >
        Write a reusable workflow in Markdown. Providers load this file when
        relevant; edits can affect future turns.
      </p>
      {skill && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="break-all">Original: {skill.path}</p>
          {readOnly && (
            <p>Imported skill. Edit its original files to make changes.</p>
          )}
          {skill.error && (
            <p role="alert" className="text-destructive">
              {skill.error}
            </p>
          )}
          {skill.publications.map((publication) => (
            <p
              key={publication.provider}
              className={publication.error ? 'text-destructive' : ''}
            >
              {publication.provider}: {publication.error ?? publication.status}
            </p>
          ))}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive break-words"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-3 [&>a]:text-sm [&>a]:text-muted-foreground [&>a:hover]:text-foreground">
        {!readOnly && (
          <Button name="intent" value="save" disabled={busy}>
            {busy ? 'Saving…' : skill ? 'Save changes' : 'Create skill'}
          </Button>
        )}
        <Link to="/skills">Cancel</Link>
      </div>
    </Form>
  );
}
