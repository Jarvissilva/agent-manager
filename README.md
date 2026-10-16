# Agent Manager

Local agent manager. Requires Node.js 24+ and pnpm 10.22.0.

## Structure

- `client/`: React + TypeScript with Vite and React Router. The projects page uses
  a sidebar layout loader to list projects and a New Project page with a form action.
- `server/`: Node.js + TypeScript with Express and Node's built-in SQLite support.
  `router.ts` registers API routes; `controllers/` contains HTTP handlers.
  `repositories/` contains database queries for agents, skills, schedules, and sessions.
  `services/sessions.ts` handles live processes and session lifecycle;
  `repositories/sessions.ts` handles saved session history. `lib/` contains database setup, security checks,
  chat streaming, and provider integrations under `lib/providers/`.

Sessions is the default landing page, showing all conversations by recent activity with search,
project/folder/status filters, and optional grouping by project or folder. Scheduled provides the same global access to scheduled work.
Desktop navigation uses a narrow sidebar with Home, Sessions, Scheduled, Projects, Agents, and Skills. Icons sit above labels; the toggle at the top switches to an icon-only rail. Mobile uses a bottom navigation bar with the same destinations. Chat keeps the composer above the bar and resizes with the on-screen keyboard.
Projects are optional collections: start directly at `/sessions/new` and choose a folder,
provider, and optional agent/project. Conversations use `/sessions/:sessionId`.
The composer contains model, reasoning, provider, and file access settings.
Codex, Antigravity, and OpenCode also offer a Plan toggle in the composer. Off uses normal
execution; on uses the provider’s native planning behavior. Turn Plan off before
asking for implementation. Mode changes apply to the next message and are saved with
the chat settings for resume. OpenCode switches between its native Plan and Build
agents, preserving its restrictions on editing project files in Plan mode.
Shift+Tab toggles Plan while the composer is focused when shortcuts are enabled.
Projects (`/projects`) provides a searchable list with inline name editing and deletion. Deleting a project with sessions requires choosing to keep them under No project or delete their saved records and messages. End running sessions before deleting their records; keeping sessions preserves running processes. Schedules are kept under No project. Projects have no individual overview pages; sessions and schedules live in their global lists. Home (`/`) starts a chat directly with an optional project, provider, and working folder, and lists running/stopping sessions with live refresh.
Sessions can be deleted from their list or options menu after confirmation.
Deletion removes Agent Manager history and messages, including legacy resume
aliases, and leaves project files and native provider conversations intact.
Running/stopping sessions must end and queued sessions must be cancelled first.
History for an unfinished multi-session scheduled execution is protected until
all its sessions finish.
Older project chat and schedule URLs redirect to the canonical global routes.

## Development

```sh
pnpm install
pnpm dev
```

Vite serves the client at `http://localhost:5173` by default and proxies `/api`
requests to Express at `http://127.0.0.1:3001`.

Run either workspace separately with `pnpm dev:client` or `pnpm dev:server`.

## Projects

Projects are optional. Create one with a name when you want to organize related sessions and schedules; it does not own a working directory.
Each new session selects its own folder. Sessions can be filtered or grouped by project or folder.
The sidebar has a single Projects link. Add projects from `/projects/new` and edit their names inline on `/projects`. Old project overview links redirect to `/projects`.

Working folders accept absolute paths or `~/` paths. The server resolves symlinks and checks that the directory exists.
Sessions keep their saved folder when resumed. Multiple projects can use the same directory.
Schedule steps each select their own folder; project folder suggestions come from saved sessions and schedule steps.

**Browse** opens the native folder dialog on the server machine through XDG Desktop Portal.
It requires a desktop session with a FileChooser portal (version 3+) and Python 3 with dbus-python and GLib.
Cancelling keeps the current selection; leaving the page closes the pending picker request. Manual paths also work over remote access.

- `GET /api/projects`: list `{ id, name, paths }`, where paths are derived from saved work.
- `POST /api/projects`: send `{ "name": "Acme" }`; returns 201 or a validation error with 400.
- `DELETE /api/projects/:projectId`: send `{ "sessionDisposition": "keep" }` or `{ "sessionDisposition": "delete" }` when sessions exist. Omitting the choice (or using `"empty"`) is allowed only for projects without sessions. Running sessions prevent destructive deletion.
- `PATCH /api/projects/:projectId`: rename with `{ "name": "Acme" }`; IDs and work assignments stay unchanged.
- `POST /api/projects/select-directory`: retained native folder picker endpoint; returns `{ "path": "/selected/folder" }` or `{ "path": null }` on cancellation.

The optional-project migration backs up SQLite to `<database>.before-optional-projects.sqlite` and preserves existing assignments, transcripts, schedule steps, indexes, and queued snapshots. Standalone work stores `projectId: null`. End a session before assigning, moving, or removing its project; its working folder and conversation stay unchanged. Schedule project changes affect future occurrences.

The directory migration backs up SQLite to `<database>.before-session-directories.sqlite`, moves legacy project paths into sessions and schedule steps, and preserves queued snapshot directories and conversation history.
Unavailable historical folders remain visible; resume and scheduled execution fail clearly until those folders are available again.

Projects persist in `server/data/agent-manager.sqlite`, independent of the working
directory used to start the server. Set `AGENT_MANAGER_DB_PATH` to use a different
database file. Local database files are ignored by Git.

## Agent providers

Select Codex (`codex`), Antigravity (`agy`), or OpenCode (`opencode`) when
configuring chats, agents, and scheduled sessions. `GET /api/providers` returns their IDs, names, commands, and an
`available` flag, based on executable files found in the server's `PATH`.
This checks installation only; it does not start agents or verify authentication.
Provider definitions are kept in server code; no provider database table is needed.

## Antigravity (agy)

Choose **Antigravity** in a new chat’s composer, or choose it as an agent’s provider.
The model menu comes from `agy models`; model and reasoning changes apply on the
next message. Sign in with `agy` locally first. Agent Manager uses your existing
credentials and never edits your global Antigravity settings or project files.

Chat uses the [official CLI streaming protocol](https://www.antigravity.google/docs/cli/headless/).
Each turn runs in a separate process and resumes the exact saved conversation ID.
Replies, tool activity, command output, errors, and stop controls use the same
chat interface. Ended conversations keep their transcript and resume in place.
Agent role instructions and skill metadata are included as context; AGY
does not expose a separate developer-instructions field.

AGY uses `accept-edits` mode and your local command permission policy. Tools
requiring confirmation are soft-denied by the CLI; its streaming protocol does
not expose approval responses. Configure Antigravity MCP tools locally. AGY has no equivalent to
Codex’s read-only file sandbox, so that choice is unavailable for AGY chats and
rejected for AGY schedules. No permission-bypass flag is passed.

Schedules use the selected provider and save its configuration in each session.
Continuing a scheduled conversation keeps its original provider and instructions.

`GET /api/providers/antigravity/models` returns the CLI catalog, cached for five
minutes. Start a default AGY chat with `POST /api/projects/:projectId/session`
and `{ "transport": "chat", "provider": "antigravity", "workingDirectory": "/absolute/folder" }`. Optional `agentId`
and `settings` use the same API as Codex. Resuming keeps the original provider.

## OpenCode

OpenCode v2 (`opencode serve`) is supported in the session provider selector and
agent forms. The manager starts an authenticated server on a random loopback port
for each session, using the host's existing OpenCode configuration and login.
Connect a model provider in OpenCode first; an empty catalog shows a setup message.
Models and reasoning variants are discovered for the selected working directory.

Chat supports streamed replies, tool activity, approve-once/decline, questions,
stop response, and resume using the same manager and native session IDs. Saved
agent instructions use OpenCode's native session instruction entries;
your message stays a separate prompt. The project’s own AGENTS.md still applies.

File access is enforced through OpenCode tool permissions, not an OS sandbox.
Read-only allows read/glob/grep and denies other tools, including shell and
subagents. Edit mode allows project file edits and asks before commands, external
access and other tools. OpenCode schedules use the same chat protocol and saved instruction snapshots.
Approvals and questions wait for the user within the schedule timeout; cancellation
and timeouts stop their server.
Configure OpenCode MCP tools through OpenCode itself.

## Agents

Open **Agents** in the sidebar to create, list, edit, or delete a reusable agent.
Each agent has a unique name (up to 100 characters, case-insensitive), a provider,
and instructions (up to 20,000 characters). Codex, Antigravity and OpenCode are supported
for agents, live sessions, and schedules. OpenCode is listed for installation detection.

Select an agent when starting a session before starting Codex, or use **Default Codex**
for a session without an agent. New chats also have a provider selector in the
composer. Instructions for Codex are supplied using its
`developer_instructions` configuration; no project files are created or modified
to configure the agent. The session saves its agent name and instructions as a
snapshot. Editing an agent affects new sessions. Resume uses the saved snapshot,
including after the agent is deleted. Deletion removes the reusable configuration
while keeping conversations and their saved instructions.
An agent used by a schedule must be reassigned or removed from it before deletion.

- `GET /api/agents`: list saved agents, ordered by name.
- `POST /api/agents`: create with `{ "name": "Reviewer", "provider": "codex",
"instructions": "Review code and report findings." }`; returns 201.
- `GET /api/agents/:agentId`: load one agent.
- `PUT /api/agents/:agentId`: update the same fields, with optional `skillIds`.
- `DELETE /api/agents/:agentId`: delete; returns 204.

Invalid fields return 400, missing agents 404, and duplicate names 409.
Agents persist in the same SQLite database as projects and sessions.

## Skills

Skills are native `SKILL.md` folders, loaded by providers when relevant rather
than pasted into every prompt. Create a skill with a display name, permanent
lowercase native name, a description of when to use it, and Markdown instructions.
Supporting scripts and references can live beside `SKILL.md`.

App-created originals live in `server/data/skills/<native-name>/` (beside the
configured database when `AGENT_MANAGER_DB_PATH` is set). Codex and OpenCode
share individual symlinks in `~/.agents/skills/`. Antigravity receives synchronized
copies in `~/.gemini/antigravity-cli/skills/`; its symlink discovery has not been
verified. Copies refresh on startup, skill reads/edits and message submission.
`AGENT_MANAGER_AGY_SKILL_LINKS=1` opts into links only if your CLI supports them.
`AGENT_MANAGER_SKILL_HOME` overrides the publication home for isolated testing.

Import a discovered skill or choose its folder using **Browse**. Imported files
stay in place, are read-only in the app, and their folder name must match their
portable native name. Existing unrelated folders are never overwritten. Provider
publication errors and missing originals appear on the skill page.

Assign up to 50 skills to an agent to suggest relevant native workflows. Global
publication makes skills available outside Agent Manager and outside those
assignments; assignments are not an access boundary. Use **Skills** in the chat
composer to explicitly select one: Codex uses `$name` and a native skill input,
OpenCode uses `@name`, and Antigravity uses `/name` at the start of the message.
Legacy `$name` references are also translated for registered skills in other
providers. Skill loading does not grant permission to execute its scripts.

Existing database skills migrate into files without changing their IDs or agent
assignments. Legacy text stays in SQLite as a recovery copy. Existing sessions
keep their saved context; new sessions save role instructions and skill metadata
only. Native files are live, so edits may affect later turns. Deletion unregisters
the skill and removes only app-owned discovery links/copies; originals are kept.

SSH connection details belong in `~/.ssh/config`, not in skill records. A skill
can describe a workflow such as deploying an app using an existing SSH alias.

- `GET /api/skills`: list skills, including native name, source, original path and publication status.
- `POST /api/skills`: create with `{ "name": "Code review", "nativeName": "code-review", "description": "Use when reviewing code.", "instructions": "Check correctness." }`.
- `GET /api/skills/discover`: list unregistered native global skill folders.
- `POST /api/skills/import`: register `{ "path": "/absolute/path/to/skill" }`.
- `POST /api/skills/select-directory`: open the existing native folder picker.
- `GET /api/skills/:skillId`: load a skill and refresh its publication.
- `PUT /api/skills/:skillId`: edit a managed skill; native names are permanent.
- `DELETE /api/skills/:skillId`: unregister and remove agent assignments; returns 204.

Invalid fields return 400, missing skills 404, and duplicate names or read-only
edits 409. Descriptions accept 1–1,024 characters and instructions 1–20,000.
Legacy API callers may omit native name/description; sensible defaults are generated.

## Local tools

Use local tools such as `ssh` and `gh` directly, with skills for reusable workflow instructions.
Configure MCP tools through each provider itself.

Existing connector configuration is removed on startup after a one-time database backup
(`<database-path>.before-remove-connectors.sqlite`). Sessions, transcripts, agents, skills,
and schedules are preserved; saved connector assignments are removed. Existing credential
key files are left untouched for restoring the backup.

## Codex sessions

Open a project and send the first message to start a conversation. There is no
separate start screen. The composer includes a model selector and reasoning
selector, with file access and the initial agent selection under **Chat settings**.
Model choices and supported reasoning levels come from the installed Codex
provider's `model/list` catalog, cached for five minutes. Changing models resets
reasoning to that model's default. Invalid model/reasoning combinations are
rejected by the server. These settings apply to the next message, persist with
the session, and survive resume; they do not change global CLI configuration.

Chat supports multiline text, streamed Markdown responses, expandable tool
activity and file changes, and command/file approval requests. Enter sends;
Shift + Enter inserts a new line. The stop button interrupts the response without
ending the conversation. **End session** in the session menu terminates the
provider and its children, escalating to a force stop after two seconds if needed.

All sessions use chat. The embedded terminal, terminal switching, and terminal
WebSocket endpoint have been removed. Existing conversations keep their cached
messages and native provider IDs and resume in chat, including records created
by older terminal versions. Agent tool commands and output remain visible as
expandable activity inside the conversation.

For a saved chat, sending a message resumes it automatically while preserving
its ID and history. Another live session or queued session in the project blocks a
new launch until it ends.

Chat uses the installed CLI's [Codex app-server protocol](https://developers.openai.com/codex/app-server)
over stdio, inheriting your existing CLI login and configuration. File access
can be read-only or workspace-write; this controls the local filesystem sandbox.
On-request approvals are routed to the user and never automatically accepted.
Structured command/file approvals and text questions are supported; other server
requests are rejected explicitly. No additional API key is needed. Scheduled sessions use the same chat integration.

Each project can have multiple live sessions, including sessions using the same
folder or overlapping parent/child folders. Projects organize work without
locking it. Navigating away or closing the browser
leaves it running. Reopening reconnects to the live state without duplicating
messages. Session metadata and chat items persist in SQLite. Restarting the
server marks unfinished sessions interrupted, retaining their transcripts.

Open a finished or interrupted conversation from **Session history** and send
a message to reopen it. Resume updates the existing session, keeping its ID, original
start time, saved agent/skill snapshot, and latest resume time. Chat
obtains its conversation UUID directly from the provider and hydrates saved
provider history when resuming, including conversations created in the terminal.
Codex must still have that conversation locally; empty or deleted provider
conversations can be unavailable. Startup recovers native IDs from any logs left
by older terminal versions. Other live or queued sessions do not block
starting or resuming; only reopening the same conversation is rejected.

- `POST /api/sessions`: create with `workingDirectory`, optional `projectId` (or null), `provider`, `agentId`, `settings`, and `transport`.
- `GET /api/sessions/:sessionId`: saved metadata, including optional project and fixed working directory.
- `POST /api/sessions/:sessionId/resume`: resume the same conversation with `transport` and optional `settings`.
- `PATCH /api/sessions/:sessionId`: assign an ended session with `{ "projectId": 1 }`, or remove its assignment with `{ "projectId": null }`. Active/queued sessions return 409.
- `GET /api/projects/:projectId/session`: legacy latest session, saved sessions, and
  `queuedSessionCount`. Metadata includes `transport` (new sessions use `chat`),
  `source`, schedule information, saved configuration, and execution outcome.
- `POST /api/projects/:projectId/session`: start with `{ "transport": "chat", "workingDirectory": "/absolute/folder" }`,
  optionally adding `agentId` and `settings`. Resume with `resumeSessionId` and `transport`.
  Omitted transport uses chat. Explicit terminal requests return 400. Duplicate launches
  return 409; resumed sessions reject replacement agent or directory configuration.
- `DELETE /api/projects/:projectId/session`: legacy stop for a project with at most
  one open session; returns 409 when multiple sessions are open. Use
  `POST /api/sessions/:sessionId/cancel` to stop a specific session.
- `GET /api/sessions/:sessionId/chat`: SSE snapshot followed by item/state updates.
  Saved transcripts remain readable after the session ends.
- `GET /api/providers/codex/models`: visible provider models, display names, defaults,
  and supported reasoning levels. Pass `workingDirectory` as a query parameter for folder-specific catalogs. Returns 503 if the catalog cannot be loaded.
- `POST /api/sessions/:sessionId/messages`: send `{ "prompt": "..." }`, optionally
  with `settings: { model: "model-id", effort: "high", permissions: "read-only" }`.
  `model` and `effort` can be null for provider defaults; permissions also supports
  `workspace-write`. A second message while a turn is active returns 409.
- `POST /api/sessions/:sessionId/interrupt`: stop the active response.
- `POST /api/sessions/:sessionId/requests/:requestId`: respond with
  `{ "decision": "accept" }` or `{ "decision": "decline" }`, or with
  `{ "answers": { "question-id": "answer" } }` for a text question.

Express binds to loopback. Browser API requests use the trusted-origin checks
described under private remote access below. Vite development and preview proxy
API traffic, including chat streaming.

## Sessions and schedules

Use **Sessions → New session** for immediate work and **Scheduled → New schedule** for work that should
start later or repeat. Both can be created without a project. Schedule editors use `/schedules/new` and `/schedules/:scheduleId`. There are no separate Jobs or Runs pages or APIs.

A schedule stores its name, optional project, timing, and 1–20 ordered sessions.
Each session has a name, working directory, optional agent, provider, prompt, model, reasoning,
file access, and timeout (1–1,440 minutes). Add, remove, or reorder sessions
in the schedule editor. Choose a one-time
local date/time or a five-field cron expression with an IANA timezone. Preview
upcoming times before saving; `0 9 * * 1-5` means weekdays at 09:00. The local
server must be running. After downtime, one missed occurrence is queued per
schedule, then recurring schedules advance to a future time.

Each occurrence creates a durable Session for every step, grouped by occurrence
in schedule history. Prompts, agent instructions, skills, settings, timeouts, and
working directories are frozen at enqueue time. Editing configuration affects future occurrences.
Steps run in order as separate conversations; each receives its own prompt followed
by the immediately preceding session’s final response, excluding tool logs. Empty
successful responses do not block execution. Failure, cancellation, timeout, or
interruption skips remaining steps with an explanation. There are no automatic retries.
Timeouts begin when each session starts, excluding queue time.
Independent scheduled occurrences can run concurrently, even in the same project
or working folder, and do not block manual sessions. Steps within each occurrence
remain ordered and retain their handoff and failure handling.

Scheduled work uses the normal provider chat integration. Replies, tools,
approvals, and questions appear in the full session page. Approvals are never
automatically accepted. Codex and OpenCode can wait for user input until the
timeout; AGY retains its CLI confirmation limitations described above.
After the initial turn, the manager ends the runtime and frees the project,
keeping the session, transcript, result, and provider conversation ID. Send a
message in that session to continue the same conversation.

Pause prevents future triggers without cancelling queued work. Delete cancels
queued sessions, lets active work finish, and preserves history. One-time
schedules complete after enqueueing; edit their date to schedule again.
Cancellation, timeout, and shutdown stop provider processes; forced termination
follows after two seconds. Restart preserves queued sessions and marks unfinished
active work interrupted without replaying it; later steps in that occurrence are skipped.
Continuing a historical chat does not rerun its workflow.

The migration backs up SQLite to `<database>.before-session-schedules.sqlite`,
copies schedule configuration, and converts old executions into sessions in a
transaction. Existing IDs, conversation IDs, snapshots, output, results, errors,
and timestamps are retained. Old `/runs/:id` links redirect to the session;
Jobs navigation redirects to Schedules. Historical conversations without a native
provider ID remain readable but cannot be continued.

- `GET/POST /api/schedules`: list/create, optional `projectId` filter.
- `GET/PUT/DELETE /api/schedules/:scheduleId`: load, update, or delete.
- `POST /api/schedules/preview`: validate and return `{ dates }`.
- `GET /api/schedules/:scheduleId/sessions`: associated session history.
- `GET /api/sessions`: session history across projects, with optional `projectId` filter.
- `POST /api/sessions/:sessionId/cancel`: cancel queued or active work.
- Schedule input: `name`, `projectId`, `steps`, `kind`, `runAt`, `cron`, `timezone`, and `enabled`.
- Each `steps[]` entry: `name`, `workingDirectory`, nullable `agentId`, `provider`, `prompt`,
  `settings: { model, effort, permissions }`, and `timeoutMinutes`.
- Legacy flat single-session input is accepted as one step; responses always contain `steps`.
- Scheduled sessions include `occurrenceId`, zero-based `stepIndex`, and `stepName`.
  The `skipped` outcome identifies steps stopped by an earlier unsuccessful session.

The ordered-session migration creates `<database>.before-schedule-steps.sqlite`,
converts existing schedules into one-step definitions, and preserves historical sessions.

No Redis or separate worker is required.

Individual session deletion uses `DELETE /api/sessions/:sessionId`: `204` on
success, `404` when missing, or `409` while the session or dependent scheduled
execution is unfinished. Trusted-origin checks also apply.

## Production with PM2 and private Tailscale access

The production server serves `client/dist`, the API, and chat streaming
from one loopback port, `127.0.0.1:6001`. React routes also work when opened
directly or refreshed. Development still uses Vite and server port `3001`.
The server accepts a `PORT` environment variable; the root PM2 ecosystem file
sets it to `6001` and runs one process to coordinate sessions and schedules.

Create a root `.env` using `.env.example` and set your exact trusted origin:

```dotenv
AGENT_MANAGER_PUBLIC_ORIGIN=https://agent-manager.example.ts.net
```

The server's dev/start scripts and PM2 configuration load this optional file;
existing process environment variables take precedence. An empty value preserves
localhost-only browser origins. Restart the server after changing it.
Only the configured HTTPS origin and matching localhost origins are accepted;
unrelated origins and mismatched hosts are rejected for API requests. Local browser access is available at `http://localhost:6001`;
use the Tailscale HTTPS address for remote access.

PM2 must be installed on the host. From the repository root:

```sh
pnpm prod:start
pnpm prod:status
pnpm prod:logs
```

`prod:start` builds both workspaces and starts or restarts only `agent-manager`.
Use `pnpm prod:restart` after environment changes, `pnpm prod:stop` to stop it,
and `pnpm prod:start` to deploy code changes. Restarting ends live agent sessions.
PM2 automatically restarts a crashed server; file watching is disabled.

Define a Tailscale Service named `agent-manager` with endpoint `tcp:443` in the
admin console. The host must have a tag-based identity. Configure its destination:

```sh
sudo tailscale serve --service=svc:agent-manager --https=443 http://127.0.0.1:6001
tailscale serve status
```

Approve the service host in the admin console if required. On a device connected
to your tailnet, open `https://agent-manager.example.ts.net` (replace the tailnet
suffix for another network). Serve provides private access; this setup does not
use Funnel or expose Express on a public interface. Tailscale access rules
determine which devices/users can reach it; the app has no separate account login.

After verifying the app, save the complete PM2 process list:

```sh
pm2 save
systemctl is-enabled pm2-user tailscaled
```

On this host both boot services are already enabled. On a new host, run
`pm2 startup` as the app user and execute its generated systemd installation
command, then `pm2 save`. Enable Tailscale with
`sudo systemctl enable --now tailscaled`. The saved service mapping persists
across reboots. The host must remain awake. The native folder picker opens on
the host's desktop, not on the remote phone; saved folders or manual paths can
be used remotely.

## Checks and build

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm --filter @agent-manager/server test
```

Use `pnpm format` to format the repository. After building, use
`pnpm --filter @agent-manager/client preview` to preview the client and
`pnpm --filter @agent-manager/server start` to run the compiled server.

## Analytics skills

Reusable read-only skills live in `skills/google-search-console`,
`skills/google-analytics`, and `skills/bing-webmaster`. Each includes `SKILL.md`,
Node.js 24 scripts, presets, and helpers for custom API queries. Register their
absolute folders through the existing Skills import flow. Imported skills are
edited in the repository; native discovery is handled by Agent Manager.

Google scripts use installed `gcloud` with impersonated Application Default
Credentials and per-service read-only scopes. Bing reads
`BING_WEBMASTER_API_KEY` from the environment or
`~/.config/agent-manager/credentials.env`; keep that file outside Git with mode 600. No PM2 environment change is needed for this fallback.

Run `node <skill-folder>/scripts/report.mjs --help` for commands. GA4 can discover accessible properties with `--report properties` and inspect
website URLs with `--property ID --report streams`; discovery requires the
Google Analytics Admin API in addition to the Data API. Reports support explicit dates, custom JSON requests, and
new output files via `--output`. Check returned warnings: Search Console has
privacy/top-row limits, GA4 can apply thresholding or sampling, and Bing dates
can label aggregate buckets with fixed server-side history.

Validate the retrieval scripts with
`pnpm --filter '@agent-manager/skill-*' test`.

## Google Cloud skill

`skills/gcloud` is an instruction-only skill for managing Google Cloud through the
installed CLI. Import its folder using the existing Skills flow and attach it to
agents that need cloud operations. It covers explicit project/identity selection,
resource inspection, requested changes, and verification. It uses existing CLI
authentication; analytics ADC credentials remain separate. No wrapper scripts,
extra dependencies, or infrastructure permissions are installed by this skill.

## Pinterest skill

`skills/pinterest` provides named-account and named-app Pinterest API commands for Pins, boards,
analytics, video uploads, and Trends, plus flexible documented API requests.
Import its folder through the existing Skills flow; no server restart is needed.
Run `node skills/pinterest/scripts/pinterest.mjs --help` for available commands.

Keep each account’s app credentials and issued OAuth tokens in
`~/.config/agent-manager/pinterest/accounts.json` (directory mode 700, file mode
600), outside Git. Its shape is shown in
`skills/pinterest/references/accounts.example.json`; empty token fields must be
filled locally before authenticated calls work. Add `expiresAt` as an ISO date/time
when known; refresh tokens rotate automatically when needed. Select each account
and its app explicitly with `--account NAME --app NAME`. Each account contains
a named `apps` object; credentials and token metadata live inside the selected
app entry. Trial/sandbox creation does not establish public
visibility; public publishing requires the appropriate app access tier.

Writes and media uploads are not retried automatically after uncertain failures.
Reports and publishing receipts can be saved to new files in the session working
folder with `--output`. Test the helpers with
`pnpm --filter @agent-manager/skill-pinterest test`.

## Traffic Analyst agent

`agents/traffic-analyst.md` is the maintained instruction source for the Traffic
Analyst agent. It uses Codex with `google-search-console`, `google-analytics`, and
`bing-webmaster` attached through the existing agent skill assignments. It
discovers website properties, investigates traffic changes and on-site outcomes,
and produces evidence-backed reports with prioritized actions. Missing sources
are disclosed without blocking analysis of available data.

The configured agent stores a snapshot of these instructions in the database;
editing this file does not automatically update it, and editing the agent in the
UI does not update this file. Keep them synchronized when changing the agent.
For example, select Traffic Analyst when creating a session and ask:
“Analyze traffic for example.com over the last 28 complete days. Explain the
main changes and prioritize opportunities to improve qualified traffic.”

The workflow draws inspiration from Anthropic's published
[analysis](https://github.com/anthropics/knowledge-work-plugins/blob/main/data/skills/analyze/SKILL.md)
and [validation](https://github.com/anthropics/knowledge-work-plugins/blob/main/data/skills/validate-data/SKILL.md)
workflows, adapted to the existing analytics skills. No external plugin or MCP
server is required.

## Session permissions

The chat composer's settings menu applies permissions to the next message and
stores them with the session for resume. Existing sessions keep their defaults:
project writes, Codex sandbox network disabled, and approvals on request.

Codex exposes read-only, project-write, and full-access modes, a sandbox network
switch, and on-request, untrusted-command, or never-ask approval policies.
Full access disables both file and network sandbox restrictions. Never ask is
independent: in a sandbox it denies actions requiring escalation instead of
granting unrestricted access. The integration follows the installed Codex
app-server protocol and [official documentation](https://developers.openai.com/codex/app-server).

OpenCode exposes file/tool access and on-request or never-ask approvals through
tool rules, not an OS or network sandbox. With project writes and Never ask,
gated tools are denied; full access with Never ask allows all tools. Antigravity
exposes on-request or never-ask approvals using its native permission bypass flag;
separate file and network sandbox controls are not available in this integration.
Unsupported combinations are rejected by the server. All sessions use the chat
controls and retain their saved settings on resume.

## Session activity

Session badges and filters show Ready, Running, Needs input, Error, or Queued.
Running means a chat provider is generating a response or executing tools; an
open provider process between replies is Ready. Pending approvals and questions
show Needs input separately from Home's Running sessions. Failures and unexpected
interruptions show Error; successful replies and intentional stops show Ready.
Detailed scheduled outcomes remain in the session details.

Session API responses include a derived `activity` field; the stored `status`
continues to track provider lifecycle for resume, scheduling, and deletion
protection. Older terminal records now appear as chat conversations using their
saved outcome until resumed. Activity uses existing chat events and list refreshes.

## Settings and usage reporting

**Settings** (`/settings`) saves model and reasoning defaults for Codex,
Antigravity, and OpenCode in SQLite, shared across devices. These defaults apply
only to new interactive chats. Explicit composer choices take precedence;
resuming conversations and running automations retain their saved configuration.
OpenCode catalogs are loaded for the chosen working folder. An unavailable saved
default produces a notice and uses provider defaults without replacing the saved
preference. Permission defaults are unchanged.

Settings also controls the reporting timezone (initially `Asia/Kolkata`) and
optional shortcuts: Shift+Tab toggles Plan while the composer is focused on Codex
or Antigravity, Alt+N opens a new chat, and Alt+/ focuses the composer. Enter sends
and Shift+Enter inserts a newline regardless of the shortcut preference. Shift+Tab
retains normal focus navigation outside supported composers. Shortcuts ignore IME
composition and unrelated inputs or dialogs.

**Usage** (`/usage`) shows daily token totals and an agent/provider/model breakdown
with Today, 7-day, 30-day, and custom ranges (up to one year). Each session has a
usage summary and each agent links to its report. Usage is collected for chat
sessions, including automations, from provider events and durable message
projections. No transcript-based estimates or historical backfill are attempted;
older terminal sessions and missing provider data show unavailable. Partial coverage is
labelled, and reported zero remains distinct from missing usage.

Codex cumulative totals use persisted checkpoints; OpenCode messages use native
message IDs; Antigravity result totals replace provisional step sums. Cache and
reasoning details are included according to each provider's accounting and are
not added to totals twice. Cross-provider totals are analytical usage records,
not billing estimates. A resumed pre-tracking Codex conversation without a
baseline is labelled partial. UTC timestamps are grouped by the saved timezone;
changing it regroups reports without changing stored consumption.

Deleting sessions or agents preserves reporting counts, timestamps, IDs, and
labels, without retaining prompts, replies, or agent instructions in usage records.
Provider counter payloads are retained for accounting diagnostics. The feature
adds tables without changing existing session, agent, or automation records.

- `GET /api/settings`: shared provider defaults, timezone, and shortcut preference.
- `PATCH /api/settings`: update those fields; provider model/reasoning choices use
  existing catalog validation. An optional `workingDirectory` selects the catalog.
- `GET /api/usage`: accepts `from`/`to` (`YYYY-MM-DD` in the saved timezone),
  `agentId` (or `none`), `provider`, `model`, and `sessionId`; returns totals,
  coverage information, daily values, breakdowns, and filter choices.

The interface calls scheduled work **Automations**. Existing `/schedules` URLs,
API endpoints, database names, and execution behavior remain compatible.

## Session tabs and prompt queues

Opening a session adds it to the top tab bar. **+** opens an independent new-chat
draft without starting a conversation. Switching tabs preserves unsent text,
working folders, and unsent composer settings. Tabs and drafts live in browser
session storage: they survive refresh in that browser tab and are not shared
across devices. Closing a saved session tab leaves its process running; closing
a new-chat draft discards that draft. Starting a draft replaces its tab with the
saved conversation. Deleted sessions disappear from the tab bar.

While a response is running, Enter or the send button queues a follow-up prompt.
The Stop button remains available while composing. Queue entries run in FIFO
order after successful replies, using the model, reasoning, plan, and permission
settings captured when submitted. Approvals and questions keep the current turn
active, so queued prompts wait for its completion. The queue panel supports edit,
remove, pause, requeue after delivery failures, and explicit resume. Each session
can hold up to 50 pending prompts. Existing API clients retain immediate-send
behavior unless they opt into queuing.

Pending queues are stored in SQLite and keep running when the browser disconnects
or switches tabs. Errors, stopped responses, and ended sessions pause the queue.
After a server restart, all pending queues require review and explicit resume;
possibly interrupted delivery is marked for review and is never retried
automatically. Resume an ended conversation before resuming its queue. Deleting
session history also deletes its pending prompts and queue state. Automations
continue to use their existing execution workflow.

- `POST /api/sessions/:sessionId/messages`: optional `delivery: "queue"` queues
  behind the active response or existing pending prompts. Otherwise an idle
  session accepts the message immediately.
- `PATCH /api/sessions/:sessionId/queue`: use `action` (`pause`, `resume`, `edit`,
  `retry`, or `remove`), an entry `id` when applicable, and `prompt` for edits.
  Sending entries cannot be edited or removed. Retrying clears the delivery
  failure; resuming the queue is a separate explicit action.
- Session details and chat SSE snapshots include `queue`; `queue` SSE events
  update the pending list and pause state.

For validation without updating the live frontend, run typecheck and lint, build
server code, and build Vite with `--outDir /tmp/agent-manager-client-check`.
Deploy frontend and backend together with `pnpm prod:start` on the host; this
restarts Agent Manager and ends active sessions. A frontend build alone does not
reload routes in an already running production server.

OpenCode chat and Settings use a provider picker followed by that provider's
models. The catalog includes connected providers and enabled local/free
providers that require no credentials; disabled providers and models are hidden.
Choose OpenCode default to let OpenCode select the model. Switching to a specific
provider selects its default model (or its first enabled model) and resets the
reasoning variant. Unavailable saved selections remain labeled until replaced.
Connections are managed in OpenCode; refresh after changing them (catalogs are
cached for 15 seconds). Connection availability does not verify quota or access
to every model.

## Chat file attachments

Use **Attach → Browse laptop files** to select files on the machine running
Agent Manager, including from a mobile browser. Start in the chat's working
folder, navigate folders, show hidden files, or enter an absolute/`~/` path.
**Upload from this device** copies files selected on your phone or computer to
the server. Attached filenames appear above the composer and can be removed
before sending. You can send files with or without accompanying text.

Messages accept up to eight files, 20 MB per file and 40 MB total. Referencing a
laptop file does not copy it. Uploads are stored beside the SQLite database in
`uploads/<unique ID>/<filename>` with private filesystem permissions. Uploads
persist across server restarts; removing an attachment or deleting a chat does
not delete its uploaded file. Draft attachments survive browser refresh alongside
the draft; queued attachments are stored in SQLite and validated again when sent.
A moved or deleted file causes delivery to fail and pauses subsequent queued work.

All providers receive file paths in the prompt. Codex also receives native image
inputs and file mentions; OpenCode receives native image/PDF attachments. Other
formats are available through the provider's file tools, subject to the session's
permissions. File references remain visible in stored chat messages.

- `POST /api/files/browse`: JSON `{ path, hidden?, offset? }`, returns folders and
  files in pages of 200 entries with `nextOffset`.
- `POST /api/files/reference`: JSON `{ path }`, returns validated file metadata.
- `POST /api/files/uploads`: raw `application/octet-stream` file bytes with a
  URI-encoded `X-File-Name` header, returns uploaded file metadata.
- `POST /api/sessions/:sessionId/messages`: optional `attachments` array of file
  metadata or paths. Metadata is re-read from disk instead of trusting the client.

File endpoints require a trusted dashboard Origin header. Uploaded files are not
served as public assets.
