import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import Icon from './Icon';

export default function WorkingDirectoryField({
  value,
  onChange,
  suggestions = [],
  disabled = false,
}: {
  value: string;
  onChange: (path: string) => void;
  suggestions?: string[];
  disabled?: boolean;
}) {
  const id = useId();
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<AbortController | null>(null);
  useEffect(() => () => picker.current?.abort(), []);
  const choose = async () => {
    setChoosing(true);
    setError('');
    const abort = new AbortController();
    picker.current = abort;
    try {
      const response = await fetch('/api/projects/select-directory', {
        method: 'POST',
        signal: abort.signal,
      });
      const data = (await response.json()) as {
        path?: string | null;
        error?: string;
      };
      if (!response.ok) throw Error(data.error ?? 'Could not choose a folder.');
      if (typeof data.path === 'string') onChange(data.path);
    } catch (error) {
      if (abort.signal.aborted) return;
      setError(
        error instanceof Error ? error.message : 'Could not choose a folder.',
      );
    } finally {
      setChoosing(false);
    }
  };
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Working folder</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          list={`${id}-recent`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="/home/you/projects/code"
          spellCheck={false}
          required
          disabled={disabled}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || choosing}
          onClick={() => void choose()}
          aria-label="Choose working folder"
        >
          <Icon name="folder" />
          {choosing ? 'Choosing…' : 'Browse'}
        </Button>
      </div>
      <datalist id={`${id}-recent`}>
        {suggestions.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
