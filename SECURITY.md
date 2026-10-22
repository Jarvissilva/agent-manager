# Security Policy

## Scope and threat model

Agent OS is a local development tool. It is **not** designed to be exposed to a
network and ships without authentication.

- The server binds to `127.0.0.1` only (`server/src/index.ts`).
- Session working folders are chosen by the user and are not sandboxed by Agent OS.
- Agent providers (Codex, Antigravity, OpenCode) are separate programs. Agent OS
  starts them and forwards prompts; whatever permissions those CLIs grant apply.
- Agent OS can run shell commands, edit files, and read anything your user account
  can read, wherever a session points. Treat it like a terminal, not a web app.
- `AGENT_MANAGER_PUBLIC_ORIGIN` exists for a private HTTPS reverse proxy such as
  Tailscale Serve. It is an origin allowlist, not an authentication mechanism.

Do not report issues that depend on exposing the server to untrusted networks as
security vulnerabilities unless they bypass the loopback binding or the origin
check.

## Reporting a vulnerability

Open a private security advisory through GitHub's **Security → Report a
vulnerability** flow on this repository. Please do not open a public issue for a
suspected vulnerability.

Include the affected version or commit, reproduction steps, and the impact you
believe it has. You will get an acknowledgement as soon as possible, and a fix or
mitigation before any public disclosure.

## Secrets

Never commit credentials. `.env`, `server/data/`, and `skills/` are ignored by Git.
Provider tokens, MCP headers, and skill credentials belong in the database, in
`~/.config/agent-manager/`, or in your shell environment — not in this repository.
