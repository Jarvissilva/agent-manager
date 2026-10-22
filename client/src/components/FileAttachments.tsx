import { useEffect, useRef, useState } from 'react';
import {
  Paperclip,
  Folder,
  File,
  Upload,
  X,
  ArrowUp,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { FileAttachment, FileListing } from '../types/files';

async function fileRequest<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? 'Could not access files.');
  return data;
}
const sizeLabel = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(size / 1024)} KB`;

export default function FileAttachments({
  files,
  onChange,
  workingDirectory,
  disabled,
  onBusyChange,
}: {
  files: FileAttachment[];
  onChange: (files: FileAttachment[]) => void;
  workingDirectory?: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState(workingDirectory || '~');
  const [pathInput, setPathInput] = useState(folder);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [hidden, setHidden] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    fileRequest<FileListing>(
      '/api/files/browse',
      { path: folder, hidden, offset },
      abort.signal,
    )
      .then((data) => {
        setListing((previous) =>
          offset && previous?.path === data.path
            ? { ...data, entries: [...previous.entries, ...data.entries] }
            : data,
        );
        setPathInput(data.path);
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setListing(null);
          setError(
            error instanceof Error ? error.message : 'Could not read folder.',
          );
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [open, folder, hidden, offset, refresh]);
  function navigate(path: string) {
    setLoading(true);
    setError('');
    setRefresh((value) => value + 1);
    setOffset(0);
    setFolder(path);
    setPathInput(path);
  }
  async function attach(path: string) {
    if (files.length >= 8 || busy) return;
    const abort = new AbortController();
    operation.current = abort;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const file = await fileRequest<FileAttachment>(
        '/api/files/reference',
        { path },
        abort.signal,
      );
      if (!files.some((previous) => previous.path === file.path)) {
        if (
          files.reduce((total, entry) => total + entry.size, file.size) >
          40 * 1024 * 1024
        )
          throw new Error('Attach up to 40 MB per message.');
        onChange([...files, file]);
      }
    } catch (error) {
      if (!abort.signal.aborted)
        setError(
          error instanceof Error ? error.message : 'Could not attach file.',
        );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function upload(selected: FileList | null) {
    if (!selected?.length) return;
    const abort = new AbortController();
    operation.current = abort;
    setBusy(true);
    onBusyChange(true);
    setError('');
    let next = files;
    try {
      if (files.length + selected.length > 8)
        throw Error('Attach up to 8 files.');
      for (const file of Array.from(selected)) {
        if (!file.size || file.size > 20 * 1024 * 1024)
          throw Error('Upload a non-empty file up to 20 MB.');
        if (
          next.reduce((total, file) => total + file.size, 0) + file.size >
          40 * 1024 * 1024
        )
          throw Error('Attachments must total 40 MB or less.');
        const response = await fetch('/api/files/uploads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
          signal: abort.signal,
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error ?? 'Could not upload file.');
        next = [...next, data as FileAttachment];
        onChange(next);
      }
    } catch (error) {
      if (!abort.signal.aborted)
        setError(
          error instanceof Error ? error.message : 'Could not upload file.',
        );
    } finally {
      setBusy(false);
      onBusyChange(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 px-2 pt-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Attach files"
              disabled={disabled || busy || files.length >= 8}
            >
              <Paperclip className="size-4" />
              {busy ? 'Attaching…' : 'Attach'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => {
                navigate(workingDirectory || '~');
                setOpen(true);
              }}
            >
              <Folder className="size-4" />
              Browse laptop files
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => input.current?.click()}>
              <Upload className="size-4" />
              Upload from this device
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(event) => void upload(event.target.files)}
        />
        {files.map((file) => (
          <span
            key={file.path}
            title={file.path}
            className="inline-flex max-w-full items-center gap-1 rounded-lg bg-background/50 px-2 py-1 text-xs"
          >
            <File className="size-3 shrink-0" />
            <span className="max-w-40 truncate">{file.name}</span>
            <span className="text-muted-foreground">
              {sizeLabel(file.size)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5"
              disabled={disabled || busy}
              aria-label={`Remove ${file.name}`}
              onClick={() =>
                onChange(files.filter((item) => item.path !== file.path))
              }
            >
              <X className="size-3" />
            </Button>
          </span>
        ))}
      </div>
      {error && !open && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto data-[size=default]:max-w-[calc(100vw-1rem)] data-[size=default]:sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Browse laptop files</AlertDialogTitle>
            <AlertDialogDescription>
              Files on the machine running Agent OS. Select up to 8 files, 20 MB
              each.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2">
            <Input
              aria-label="Laptop file or folder path"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  navigate(pathInput);
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(pathInput)}
            >
              Go
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void attach(pathInput)}
            >
              Attach path
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!listing?.parent || loading}
              onClick={() => listing?.parent && navigate(listing.parent)}
            >
              <ArrowUp className="size-4" />
              Up
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate('~')}
            >
              Home
            </Button>
            <label className="ml-auto flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(event) => {
                  setLoading(true);
                  setError('');
                  setOffset(0);
                  setHidden(event.target.checked);
                }}
              />
              Hidden files
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="min-h-32 max-h-[45dvh] overflow-y-auto rounded-lg border">
            {listing?.entries.map((entry) => {
              const selected = files.some((file) => file.path === entry.path);
              return (
                <button
                  key={entry.path}
                  type="button"
                  disabled={
                    loading ||
                    busy ||
                    (entry.type === 'file' && (selected || files.length >= 8))
                  }
                  onClick={() =>
                    entry.type === 'directory'
                      ? navigate(entry.path)
                      : void attach(entry.path)
                  }
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  {entry.type === 'directory' ? (
                    <Folder className="size-4 shrink-0" />
                  ) : selected ? (
                    <Check className="size-4 shrink-0" />
                  ) : (
                    <File className="size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 break-all">{entry.name}</span>
                  {entry.type === 'file' && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {sizeLabel(entry.size)}
                    </span>
                  )}
                </button>
              );
            })}
            {loading && (
              <p role="status" className="p-3 text-sm text-muted-foreground">
                Loading files…
              </p>
            )}
            {!loading && listing && !listing.entries.length && (
              <p className="p-3 text-sm text-muted-foreground">
                This folder is empty.
              </p>
            )}
            {listing?.nextOffset !== null &&
              listing?.nextOffset !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loading}
                  className="w-full"
                  onClick={() => {
                    if (typeof listing.nextOffset === 'number') {
                      setLoading(true);
                      setError('');
                      setOffset(listing.nextOffset);
                    }
                  }}
                >
                  Load more
                </Button>
              )}
          </div>
          <AlertDialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              {files.length} / 8 selected
            </span>
            <AlertDialogCancel>Done</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
