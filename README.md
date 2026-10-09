# Agent Manager

Local agent manager. Requires Node.js 24+ and pnpm 10.22.0.

## Structure

- `client/`: React + TypeScript with Vite and React Router. The projects page uses
  a loader to list projects and a form action to add them.
- `server/`: Node.js + TypeScript with Express and Node's built-in SQLite support.
  `router.ts` registers API routes; `controllers/project/` contains their handlers.

Agent sessions, jobs, and schedules will be added later.

## Development

```sh
pnpm install
pnpm dev
```

Vite serves the client at `http://localhost:5173` by default and proxies `/api`
requests to Express at `http://127.0.0.1:3001`.

Run either workspace separately with `pnpm dev:client` or `pnpm dev:server`.

## Projects

Add a name and use **Choose folder** to select an existing directory. The native
folder dialog opens through the machine's XDG Desktop Portal, using its configured
desktop picker. It requires a desktop session with a FileChooser portal (version
3+) and Python 3 with dbus-python and GLib. Cancelling keeps the current selection.
Closing the browser request also closes the pending portal dialog.

The API also accepts directory paths such as `~/projects/acme/code`.
Paths must be absolute or start with `~/`. The server resolves symlinks and
rejects duplicate directories. Registering a project does not modify its files.

- `GET /api/projects`: list projects as `{ id, name, path }` objects.
- `POST /api/projects/select-directory`: open the native folder picker. Returns
  `{ "path": "/selected/folder" }`, or `{ "path": null }` when cancelled.
- `POST /api/projects`: send `{ "name": "Acme", "path": "~/projects/acme/code" }`.
  Returns the project with status 201, validation errors with 400, or duplicate
  directory errors with 409. Errors use `{ "error": "message" }`.

Projects persist in `server/data/agent-manager.sqlite`, independent of the working
directory used to start the server. Set `AGENT_MANAGER_DB_PATH` to use a different
database file. Local database files are ignored by Git.

## Checks and build

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Use `pnpm format` to format the repository. After building, use
`pnpm --filter @agent-manager/client preview` to preview the client and
`pnpm --filter @agent-manager/server start` to run the compiled server.
