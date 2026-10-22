import SessionTabs from '../components/SessionTabs';
import type { Session } from '../types/session';
import { api } from '../lib/api';
import type { AppSettings } from '../types/settings';
import { useAppSettings } from '../lib/preferences';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { loadProjects } from '../lib/projects';
import { useEffect, useRef, useState } from 'react';
import {
  Link,
  Outlet,
  ScrollRestoration,
  useLocation,
  useNavigation,
  useRouteLoaderData,
  type LoaderFunctionArgs,
} from 'react-router';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import Icon, { type IconName } from '../components/Icon';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export async function projectsLoader({ request }: LoaderFunctionArgs) {
  const [projects, settings, sessions] = await Promise.all([
    loadProjects(request.signal),
    api<AppSettings>('/settings', request.signal),
    api<Session[]>('/sessions', request.signal),
  ]);
  return { projects, settings, sessions };
}
const navigationItems: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/sessions', label: 'Sessions', icon: 'chat' },
  { to: '/schedules', label: 'Automations', icon: 'clock' },
  { to: '/projects', label: 'Projects', icon: 'folder' },
  { to: '/agents', label: 'Agents', icon: 'agent' },
  { to: '/skills', label: 'Skills', icon: 'skills' },
  { to: '/mcps', label: 'MCPs', icon: 'mcp' },
  { to: '/usage', label: 'Usage', icon: 'activity' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];
export default function AppLayout() {
  const location = useLocation();
  const data = useRouteLoaderData<typeof projectsLoader>('app')!;
  const settings = useAppSettings();
  useKeyboardShortcuts(settings.shortcutsEnabled);
  const navigation = useNavigation();
  const sessionPage = /^\/sessions\/[^/]+$/.test(location.pathname);
  const [sidebarExpanded, setSidebarExpanded] = useState(
    () => localStorage.getItem('sidebar-collapsed') !== 'true',
  );
  const frame = useRef<HTMLDivElement>(null);
  const mobileNavigation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mobileNavigation.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [location.pathname]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = frame.current;
    if (!sessionPage || !viewport || !element) return;
    const resize = () => {
      if (viewport.scale !== 1) return;
      element.style.height = window.matchMedia('(max-width: 767px)').matches
        ? `${viewport.height}px`
        : '';
    };
    resize();
    viewport.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      window.removeEventListener('resize', resize);
      element.style.height = '';
    };
  }, [sessionPage]);
  const toggleNavigation = () => {
    setSidebarExpanded((previous) => {
      localStorage.setItem('sidebar-collapsed', String(previous));
      return !previous;
    });
  };
  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);
  const sidebarContent = () => (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col items-center gap-4 border-r bg-sidebar py-2 text-sidebar-foreground',
        sidebarExpanded ? 'px-2' : 'px-1',
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label={sidebarExpanded ? 'Compact sidebar' : 'Show sidebar labels'}
        title={sidebarExpanded ? 'Compact sidebar' : 'Show sidebar labels'}
        onClick={toggleNavigation}
      >
        {sidebarExpanded ? <PanelLeftClose /> : <PanelLeft />}
      </Button>
      <nav
        aria-label="Main navigation"
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto"
      >
        {navigationItems.map((item) => {
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              title={!sidebarExpanded ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center justify-center rounded-lg text-xs transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                sidebarExpanded
                  ? 'w-full flex-col gap-1.5 px-1 py-2'
                  : 'size-10',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                  : 'text-muted-foreground',
              )}
            >
              <Icon name={item.icon} className="size-5" />
              {sidebarExpanded && (
                <span className="text-[11px]">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
  return (
    <TooltipProvider delayDuration={250}>
      <div
        ref={frame}
        className={cn(
          'flex w-full bg-background',
          sessionPage
            ? 'h-dvh min-h-0 flex-col overflow-hidden md:flex-row'
            : 'min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0',
        )}
      >
        <ScrollRestoration />
        <a
          href="#main-content"
          className="sr-only z-50 rounded-lg bg-primary p-3 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 self-start md:block',
            sidebarExpanded ? 'w-22' : 'w-14',
          )}
          aria-label="Workspace navigation"
        >
          {sidebarContent()}
        </aside>
        <div
          id="main-content"
          tabIndex={-1}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col outline-none"
        >
          {navigation.state !== 'idle' && (
            <div
              role="status"
              aria-label="Loading page"
              className="absolute inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-foreground/40 motion-reduce:animate-none"
            />
          )}
          <SessionTabs sessions={data.sessions} />
          <Outlet />
        </div>
        <nav
          aria-label="Mobile navigation"
          className={cn(
            'border-t bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:hidden',
            sessionPage ? 'shrink-0' : 'fixed inset-x-0 bottom-0 z-40',
          )}
        >
          <div
            ref={mobileNavigation}
            className="flex h-16 items-center gap-1 overflow-x-auto px-2"
          >
            {navigationItems.map((item) => {
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-14 min-w-16 flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active && 'bg-sidebar-accent text-sidebar-foreground',
                  )}
                >
                  <Icon name={item.icon} className="size-5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </TooltipProvider>
  );
}
