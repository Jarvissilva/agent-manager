export type SessionTab = { key: string; path: string; draftId: string | null };
export const tabsStorageKey = 'agent-manager:session-tabs';
export function sessionTab(
  pathname: string,
  search: string,
): SessionTab | null {
  const match = /^\/sessions\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  if (match[1] !== 'new')
    return { key: `session:${match[1]}`, path: pathname, draftId: null };
  const query = new URLSearchParams(search),
    draftId = query.get('draft');
  if (!draftId || !/^[a-zA-Z0-9_-]{1,100}$/.test(draftId)) return null;
  const saved = new URLSearchParams();
  for (const key of ['draft', 'provider', 'projectId', 'workingDirectory'])
    if (query.has(key)) saved.set(key, query.get(key)!);
  return { key: `draft:${draftId}`, path: `/sessions/new?${saved}`, draftId };
}
export function readSessionTabs(value: string | null): SessionTab[] {
  try {
    const raw: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(raw)) return [];
    const tabs = new Map<string, SessionTab>();
    for (const item of raw.slice(0, 100)) {
      if (
        !item ||
        typeof item.path !== 'string' ||
        item.path.length > 10000 ||
        !item.path.startsWith('/sessions/')
      )
        continue;
      const url = new URL(item.path, 'http://local');
      if (url.origin !== 'http://local') continue;
      const tab = sessionTab(url.pathname, url.search);
      if (tab) tabs.set(tab.key, tab);
    }
    return [...tabs.values()];
  } catch {
    return [];
  }
}
export function upsertSessionTab(
  tabs: SessionTab[],
  current: SessionTab,
  replaceDraft?: string | null,
) {
  const replaceKey = replaceDraft ? `draft:${replaceDraft}` : null;
  const existing = tabs.findIndex((tab) => tab.key === current.key);
  if (existing >= 0)
    return tabs
      .filter((tab) => tab.key !== replaceKey)
      .map((tab) => (tab.key === current.key ? current : tab));
  const replacing = tabs.findIndex((tab) => tab.key === replaceKey);
  if (replacing >= 0)
    return tabs.map((tab, index) => (index === replacing ? current : tab));
  return [...tabs, current];
}
export function readBrowserStorage(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeBrowserStorage(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* Storage may be unavailable or full; tabs still work in memory. */
  }
}
