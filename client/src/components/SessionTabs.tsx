import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Plus, X } from 'lucide-react';
import type { Session } from '../types/session';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  readBrowserStorage,
  readSessionTabs,
  sessionTab,
  tabsStorageKey,
  upsertSessionTab,
  writeBrowserStorage,
} from '../lib/sessionTabs';
import { removeComposerDraft } from '../lib/composerDraft';

export default function SessionTabs({ sessions }: { sessions: Session[] }) {
  const location = useLocation(),
    navigate = useNavigate();
  const [tabs, setTabs] = useState(() =>
    readSessionTabs(readBrowserStorage(tabsStorageKey)),
  );
  const current = sessionTab(location.pathname, location.search);
  const locationKey = location.pathname + location.search;
  const [previousLocation, setPreviousLocation] = useState('');
  const strip = useRef<HTMLDivElement>(null);
  if (previousLocation !== locationKey) {
    setPreviousLocation(locationKey);
    if (current)
      setTabs((previous) =>
        upsertSessionTab(
          previous,
          current,
          new URLSearchParams(location.search).get('replaceDraft'),
        ),
      );
  }
  const visible = tabs.filter(
    (tab) =>
      tab.draftId !== null ||
      sessions.some((session) => tab.key === `session:${session.id}`) ||
      tab.key === current?.key,
  );
  useEffect(() => {
    writeBrowserStorage(tabsStorageKey, JSON.stringify(visible));
  }, [visible]);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (
      location.pathname === '/sessions/new' &&
      !sessionTab(location.pathname, location.search)?.draftId
    ) {
      query.set('draft', crypto.randomUUID());
      void navigate(`/sessions/new?${query}`, { replace: true });
    } else if (query.has('replaceDraft')) {
      const draft = query.get('replaceDraft')!;
      removeComposerDraft(`draft:${draft}`);
      writeBrowserStorage(`agent-manager:folder:${draft}`, null);
      query.delete('replaceDraft');
      void navigate(`${location.pathname}${query.size ? `?${query}` : ''}`, {
        replace: true,
      });
    }
    strip.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [location.pathname, location.search, navigate]);
  const close = (key: string) => {
    const index = visible.findIndex((tab) => tab.key === key),
      removed = visible[index];
    const remaining = visible.filter((tab) => tab.key !== key);
    setTabs(remaining);
    if (removed?.draftId) {
      removeComposerDraft(removed.key);
      writeBrowserStorage(`agent-manager:folder:${removed.draftId}`, null);
    }
    if (current?.key === key)
      void navigate(
        remaining[Math.min(index, remaining.length - 1)]?.path ?? '/sessions',
      );
  };
  if (!visible.length && !location.pathname.startsWith('/sessions/'))
    return null;
  return (
    <nav
      aria-label="Open sessions"
      className="flex shrink-0 items-center gap-1 border-b bg-sidebar/50 p-1.5"
    >
      <div
        ref={strip}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {visible.map((tab, index) => {
          const session = sessions.find(
            (session) => tab.key === `session:${session.id}`,
          );
          const title =
            session?.name ??
            session?.stepName ??
            (tab.draftId
              ? `New chat ${visible.slice(0, index + 1).filter((tab) => tab.draftId).length}`
              : 'Session');
          const active = tab.key === current?.key;
          return (
            <div
              key={tab.key}
              className={cn(
                'flex max-w-60 min-w-32 shrink-0 items-center rounded-lg border border-transparent',
                active ? 'border-border bg-background' : 'hover:bg-muted',
              )}
            >
              <Link
                to={tab.path}
                aria-current={active ? 'page' : undefined}
                title={title}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-xs"
              >
                <span
                  aria-label={session ? (session.activity ?? 'Ready') : 'Draft'}
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    session?.activity === 'running'
                      ? 'bg-emerald-400'
                      : session?.activity === 'needs_input'
                        ? 'bg-amber-400'
                        : session?.activity === 'error'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground',
                  )}
                />
                <span className="truncate">{title}</span>
              </Link>
              <Button
                size="icon"
                variant="ghost"
                className="mr-1 size-6 shrink-0"
                aria-label={`Close ${title} tab`}
                title="Close tab; session keeps running"
                onClick={() => close(tab.key)}
              >
                <X className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label="New session tab"
        onClick={() =>
          void navigate(`/sessions/new?draft=${crypto.randomUUID()}`)
        }
      >
        <Plus className="size-4" />
      </Button>
    </nav>
  );
}
