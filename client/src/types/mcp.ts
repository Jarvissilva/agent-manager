export type McpConfig =
  | {
      type: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string | null>;
      cwd?: string;
    }
  | { type: 'http'; url: string; headers: Record<string, string | null> };
export type Mcp = {
  id: number;
  name: string;
  nativeName: string;
  previousNativeName: string | null;
  enabled: boolean;
  config: McpConfig;
  publications: {
    provider: string;
    path: string;
    status: string;
    error: string | null;
  }[];
};
