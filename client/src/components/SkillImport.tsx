import { useEffect, useState } from 'react';
import { Form } from 'react-router';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

export default function SkillImport({ busy }: { busy: boolean }) {
  const [path, setPath] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [discovered, setDiscovered] = useState<
    { path: string; nativeName: string; description: string }[]
  >([]);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/skills/discover', { signal: abort.signal })
      .then(async (response) => {
        if (response.ok) setDiscovered(await response.json());
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  async function browse() {
    setPicking(true);
    setError('');
    try {
      const response = await fetch('/api/skills/select-directory', {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Could not choose a folder.');
      if (data.path) setPath(data.path);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not choose a folder.',
      );
    } finally {
      setPicking(false);
    }
  }
  return (
    <Card className="space-y-4 rounded-2xl p-5 sm:p-6">
      <h2 className="font-semibold">Import an existing skill</h2>
      <p className="text-sm text-muted-foreground">
        Choose a folder containing SKILL.md. Files stay in place and are
        read-only here.
      </p>
      <Form method="post" className="space-y-3">
        {!!discovered.length && (
          <NativeSelect
            aria-label="Existing native skills"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            disabled={busy}
          >
            <option value="">Choose a discovered skill</option>
            {discovered.map((skill) => (
              <option key={skill.path} value={skill.path}>
                {skill.nativeName}
              </option>
            ))}
          </NativeSelect>
        )}
        <Label htmlFor="skill-import-path">Skill folder on this machine</Label>
        <div className="flex gap-2">
          <Input
            id="skill-import-path"
            name="path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            required
            disabled={busy}
            placeholder="/home/you/.agents/skills/code-review"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void browse()}
            disabled={busy || picking}
          >
            {picking ? 'Choosing…' : 'Browse'}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button name="intent" value="import" disabled={busy || !path.trim()}>
          Import skill
        </Button>
      </Form>
    </Card>
  );
}
