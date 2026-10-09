# Agent Manager

Bare pnpm workspace for a local agent manager. Requires Node.js 24+ and pnpm 10.22.0.

## Structure

- `client/`: React + TypeScript with Vite. The initial app renders a blank page.
- `server/`: Node.js + TypeScript with Express. No application routes yet.

Shared packages, storage, and agent integrations will be added when needed.

## Development

```sh
pnpm install
pnpm dev
```

Vite serves the client at `http://localhost:5173` by default. Express listens at
`http://127.0.0.1:3001`; requests return 404 until routes are added.

Run either workspace separately with `pnpm dev:client` or `pnpm dev:server`.

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
