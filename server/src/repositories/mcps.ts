import { database } from '../lib/database.js';

export type McpRecord = {
  id: number;
  name: string;
  nativeName: string;
  previousNativeName: string | null;
  enabled: number;
  createdAt: string;
  updatedAt: string;
  publications: string;
};
export type McpPublication = {
  mcpId: number;
  provider: string;
  path: string;
  signature: string;
};
export function listMcps() {
  return database
    .prepare('SELECT * FROM mcp_servers ORDER BY name COLLATE NOCASE')
    .all() as unknown as McpRecord[];
}
export function findMcp(id: number) {
  return database.prepare('SELECT * FROM mcp_servers WHERE id=?').get(id) as
    McpRecord | undefined;
}
export function mcpPublications(id: number) {
  return database
    .prepare('SELECT * FROM mcp_publications WHERE mcpId=?')
    .all(id) as unknown as McpPublication[];
}
export function saveMcpPublication(value: McpPublication) {
  database
    .prepare(
      'INSERT INTO mcp_publications(mcpId,provider,path,signature) VALUES(?,?,?,?) ON CONFLICT(mcpId,provider) DO UPDATE SET path=excluded.path,signature=excluded.signature',
    )
    .run(value.mcpId, value.provider, value.path, value.signature);
}
export function forgetMcpPublication(id: number, provider: string) {
  database
    .prepare('DELETE FROM mcp_publications WHERE mcpId=? AND provider=?')
    .run(id, provider);
}
