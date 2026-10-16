import { database } from '../lib/database.js';
import type { AgentProvider } from '../lib/providers/types.js';

export type AppSettings = {
  providers: Record<
    AgentProvider,
    { model: string | null; effort: string | null }
  >;
  timezone: string;
  shortcutsEnabled: boolean;
};

export function getSettings(): AppSettings {
  const row = database
    .prepare("SELECT value FROM app_settings WHERE key='preferences'")
    .get();
  return row
    ? (JSON.parse(String(row.value)) as AppSettings)
    : {
        providers: {
          codex: { model: null, effort: null },
          antigravity: { model: null, effort: null },
          opencode: { model: null, effort: null },
        },
        timezone: 'Asia/Kolkata',
        shortcutsEnabled: true,
      };
}
export function saveSettings(settings: AppSettings) {
  database
    .prepare(
      "INSERT INTO app_settings(key,value) VALUES('preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(JSON.stringify(settings));
  return settings;
}
