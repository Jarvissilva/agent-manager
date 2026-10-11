import { useEffect, useState } from 'react';
import { Check, Copy, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
export default function CopyButton({
  text,
  label = 'Copy message',
}: {
  text: string | (() => string);
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const title =
    state === 'copied'
      ? 'Copied'
      : state === 'error'
        ? 'Could not copy'
        : label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={title}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                typeof text === 'function' ? text() : text,
              );
              setState('copied');
            } catch {
              setState('error');
            }
          }}
          className="rounded-lg text-muted-foreground"
        >
          {state === 'copied' ? (
            <Check />
          ) : state === 'error' ? (
            <AlertCircle />
          ) : (
            <Copy />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
