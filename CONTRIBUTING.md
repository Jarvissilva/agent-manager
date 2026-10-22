# Contributing

Thanks for taking a look at Agent Manager.

## Before you start

- Node.js 24 or newer and pnpm 10.22.0 (`corepack enable` will pick up the pinned
  version).
- At least one provider CLI installed if you want to exercise chat end to end.
  Most tests do not need one.

```sh
pnpm install
pnpm dev
```

Vite serves the client at `http://localhost:5173` and proxies `/api` to Express at
`http://127.0.0.1:3001`.

## Checks

Run these before opening a pull request:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @agent-manager/server test
```

`pnpm format` fixes formatting.

## Layout

- `client/` — React, TypeScript, Vite, Tailwind, React Router.
- `server/` — Express, Node's built-in SQLite. `controllers/` handles HTTP,
  `repositories/` owns queries, `services/` owns lifecycle, `lib/providers/`
  contains the Codex, Antigravity, and OpenCode integrations.
- `server/tests/` — `node:test` suites. They use temporary databases and do not
  touch `server/data/`.

## Skills

Skills are user-supplied and are not part of this repository. Do not add skill
folders, provider credentials, or personal paths here. `skills/` is ignored by Git.

## Pull requests

- Keep changes focused, and describe the user-visible behaviour they change.
- Add or update a test when you touch session lifecycle, migrations, scheduling,
  or provider parsing.
- New UI copy should stay in the existing tone: short, direct, no marketing.
- Do not reformat unrelated files; Prettier handles the whole repository.

## License

By contributing, you agree that your contributions are licensed under the MIT
License in [LICENSE](LICENSE).
