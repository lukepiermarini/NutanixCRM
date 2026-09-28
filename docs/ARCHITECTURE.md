# SE Pipeline — Architecture

A deal pipeline, meeting-intelligence and task tracker for Nutanix Systems Engineers.

**Design goals for the MVP**

1. **Zero-install distribution.** One `.html` file you can email to a teammate. They double-click it and have their own workspace.
2. **Local-first and private.** Every user's data lives on their own PC (IndexedDB, plus an optional JSON file that auto-saves). There's no server and no login.
3. **AI where it counts.** Raw Zoom notes go in; out come a summary, owners, dated action items and a stage recommendation.
4. **Built to grow into SaaS.** A layered design (UI → service API → storage adapter) means a cloud backend can be added by swapping one adapter. Views don't need to change.

---

## 1. System architecture

```
┌──────────────────────────── se-pipeline.html (single file) ────────────────────────────┐
│                                                                                        │
│  UI layer (src/ui)                                                                     │
│  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   components:          │
│  │ Pipeline │ │ Tasks  │ │ Meetings │ │ Accounts │ │ Settings │   overlay (modal/      │
│  │ (kanban) │ │        │ │          │ │          │ │          │   drawer/toast),       │
│  └────┬─────┘ └───┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   editors, meeting     │
│       └───────────┴──── reads / commands ───┴────────────┘        wizard               │
│                                   │  ▲ change events                                   │
│  Service layer (src/core/store.js)▼  │                                                 │
│  ┌──────────────────────────────────────────────────────────┐   ┌───────────────────┐  │
│  │ api.accounts | deals | meetings | tasks | settings |     │   │ Meeting AI        │  │
│  │ workspace   — validation (schema.js), in-memory cache,   │◄──┤ (src/core/ai.js)  │  │
│  │ atomic multi-entity commits, event bus                   │   │ Claude ⇄ offline  │  │
│  └───────────────┬──────────────────────────────┬───────────┘   │ heuristic parser  │  │
│                  │ adapter.commit(ops)          │ snapshot      └─────────┬─────────┘  │
│  ┌───────────────▼──────────────┐   ┌───────────▼─────────────┐           │ HTTPS      │
│  │ IndexedDB adapter (db.js)    │   │ File sync (filesync.js) │           │ (user's    │
│  │ primary store, per browser   │   │ File System Access API  │           │  own key)  │
│  │ profile = per person's PC    │   │ debounced JSON mirror   │           │            │
│  └──────────────────────────────┘   └───────────┬─────────────┘           │            │
└──────────────────────────────────────────────────┼─────────────────────────┼────────────┘
                                                   ▼                         ▼
                                   ~/Documents/se-pipeline-workspace.json   api.anthropic.com
```

**Data flow for "New meeting":**
`paste/drop notes → ai.processNotes()` (Claude with structured JSON output, or the offline parser) → `sanitize()` checks the result against the contract and the IDs that really exist → **review screen** (the user edits or accepts) → `api.meetings.ingest()` does one atomic commit: creates the account/deal if needed, saves the meeting and tasks, and moves the stage → a change event re-renders the views and triggers a debounced write to the linked file.

**Key decisions**

| Decision | Why |
|---|---|
| Vanilla JS, no framework, no runtime deps | The app has to run offline from a single file forever. There are no CDN or npm supply-chain risks, and it's about 175 KB. |
| IndexedDB as the primary store | It's durable, transactional, has no size issues, and works on `file://`. `navigator.storage.persist()` asks the browser not to evict it. |
| JSON file mirror via File System Access API | This covers "saves to my PC". The user owns a real file they can back up, sync with OneDrive, or move to a new laptop. On open, the newest copy (file or browser) wins. |
| In-memory cache + event bus | Views stay synchronous and simple. A write is a single atomic IndexedDB transaction. |
| `BroadcastChannel` | Two open tabs stay consistent. |
| Human-in-the-loop review | AI output is never saved blindly. The user confirms the account, tasks and stage move. |
| API key stored only in the browser, excluded from exports/file | A shared workspace file can never leak a secret. |
| Claude called directly from the browser | There's no backend to run. The user supplies their own key, and the request carries `anthropic-dangerous-direct-browser-access`. In a SaaS version this moves server-side (see §7). |

---

## 2. File structure

```
.
├── dist/
│   └── se-pipeline.html           ← THE deliverable: share this one file
├── src/
│   ├── index.template.html        HTML shell; CSS/JS are inlined at build time
│   ├── styles/app.css             design tokens, light/dark, responsive
│   ├── core/                      framework-free domain + data layer (unit-testable in Node)
│   │   ├── util.js                ids, local-date math, formatting
│   │   ├── schema.js              stages, entity normalizers, snapshot migrations
│   │   ├── db.js                  IndexedDB adapter (+ in-memory fallback)
│   │   ├── store.js               service layer = the "API"
│   │   ├── filesync.js            auto-save to a JSON file on disk, import/export
│   │   └── ai.js                  Claude client, JSON schema, offline parser, date NLP
│   ├── ui/
│   │   ├── dom.js                 h() element builder (textContent only → XSS-safe)
│   │   ├── sample.js              demo workspace
│   │   ├── components/
│   │   │   ├── overlay.js         modal, drawer, toast, confirm/prompt
│   │   │   ├── common.js          badges, selects, task row, .ics export
│   │   │   ├── editors.js         deal/account/task forms + live detail drawers
│   │   │   └── meeting-wizard.js  New Meeting flow + meeting detail
│   │   └── views/
│   │       ├── pipeline.js        7-column drag-and-drop board
│   │       ├── tasks.js           reminders grouped by due date, quick-add
│   │       ├── meetings.js        meeting log + accounts grid
│   │       └── settings.js        profile, AI, storage/backup
│   └── app.js                     bootstrap, hash router, header, reminders
├── tests/
│   ├── core.test.mjs              unit tests (node --test)
│   ├── load.mjs                   loads browser sources into a Node vm
│   └── e2e.mjs                    Playwright smoke test of the built file
├── docs/ARCHITECTURE.md
├── build.mjs                      zero-dependency bundler → dist/se-pipeline.html
└── package.json
```

---

## 3. Database schema

### 3.1 Current (IndexedDB `nutanix-se-pipeline`, version 1)

| Object store | Key | Indexes |
|---|---|---|
| `accounts` | `id` | `name` |
| `deals` | `id` | `accountId`, `stage` |
| `meetings` | `id` | `accountId`, `dealId`, `date` |
| `tasks` | `id` | `accountId`, `dealId`, `meetingId`, `status`, `dueDate` |
| `meta` | out-of-line key | `settings`, `fileHandle`, `lastChangeAt` |

Every record passes through `schema.normalize.<entity>()` on write. This covers UI input, AI output and imported files, so no bad data ever reaches the store.

### 3.2 Entities

```ts
Account  { id, name, industry, partner, website, notes,
           contacts: [{ id, name, title, email, phone, role }],
           createdAt, updatedAt }

Deal     { id, accountId → Account, name,
           stage: 'identified'|'discovery'|'develop'|'tech_diff'|'tech_win'|'closed_won'|'closed_lost',
           position (float, manual order within a column),
           amount, closeDate (YYYY-MM-DD), useCase, products[], partner, accountExec,
           competitors[], successCriteria, nextStep, lostReason,
           stageHistory: [{ stage, at }], createdAt, updatedAt }

Meeting  { id, accountId → Account, dealId → Deal?, title, date,
           attendees: [{ name, organization, role }],
           summary, discussionPoints[], painPoints[], requirements[], environment[],
           competitors[], risks[], decisions[], followUpEmail,
           stageBefore, stageAfter, stageRationale,
           rawNotes, processedBy: 'ai'|'heuristic'|'manual', createdAt, updatedAt }

Task     { id, title, details, dueDate, priority: 'high'|'medium'|'low',
           owner: 'me'|'account_exec'|'customer'|'partner'|'nutanix_other', ownerName,
           status: 'open'|'done', completedAt,
           accountId?, dealId?, meetingId?, createdAt, updatedAt }
```

**Pipeline stages** (defined in `schema.js`; the definitions are shown in the UI and given to the AI):

| # | id | Stage | Exit criteria |
|---|---|---|---|
| 1 | `identified` | Identified Opportunity | Discussed with the end user or partner. We believe there's a fit or need, and next steps are planned. Ready to review with your manager. |
| 2 | `discovery` | Opportunity Discovery | Pain/gain/risk validated, customer metrics identified, mutual agreement to progress. "Why do anything" is established. |
| 3 | `develop` | Develop Opportunity | Resources identified and validated. Requirements, timing and stakeholder interests established. |
| 4 | `tech_diff` | Technical Differentiation | Configuration being determined. POC underway or working toward agreed success criteria. |
| 5 | `tech_win` | Technical Win | Customer has agreed the Nutanix configuration solves their technical requirements. |
| 6 | `closed_won` | Closed Won | |
| 7 | `closed_lost` | Closed Lost | Captures `lostReason`. |

Deletes cascade in the service layer. Deleting an **account** removes its deals, meetings and tasks. Deleting a **deal** removes its tasks and unlinks its meetings. Deleting a **meeting** keeps the tasks created from it and unlinks them.

### 3.3 Workspace file format (export / auto-save)

```json
{ "app": "nutanix-se-pipeline", "schemaVersion": 1, "savedAt": "ISO-8601",
  "settings": { "userName": "…", "workspaceName": "…", "model": "…" },
  "accounts": [], "deals": [], "meetings": [], "tasks": [] }
```

`schema.migrateSnapshot()` upgrades older files on import. To change the schema, bump `SCHEMA_VERSION` and add a migration step there.

### 3.4 Cloud schema (PostgreSQL, for the multi-tenant phase)

```sql
create table workspaces (id uuid primary key, name text not null, created_at timestamptz default now());
create table users      (id uuid primary key, email citext unique not null, name text, created_at timestamptz default now());
create table memberships(workspace_id uuid references workspaces on delete cascade,
                         user_id uuid references users on delete cascade,
                         role text not null default 'member', primary key (workspace_id, user_id));

create type deal_stage as enum ('identified','discovery','develop','tech_diff','tech_win','closed_won','closed_lost');
create type task_owner as enum ('me','account_exec','customer','partner','nutanix_other');

create table accounts (
  id uuid primary key, workspace_id uuid not null references workspaces on delete cascade,
  name text not null, industry text, partner text, website text, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create unique index on accounts (workspace_id, lower(name));
create table contacts (
  id uuid primary key, account_id uuid not null references accounts on delete cascade,
  name text not null, title text, email text, phone text, role text);
create table deals (
  id uuid primary key, workspace_id uuid not null references workspaces on delete cascade,
  account_id uuid not null references accounts on delete cascade, owner_id uuid references users,
  name text not null, stage deal_stage not null default 'identified', position double precision not null,
  amount numeric(14,2) default 0, close_date date, use_case text, products text[], partner text,
  account_exec text, competitors text[], success_criteria text, next_step text, lost_reason text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create index on deals (workspace_id, stage, position);
create table deal_stage_history (
  deal_id uuid references deals on delete cascade, stage deal_stage not null, at timestamptz not null default now(),
  changed_by uuid references users);
create table meetings (
  id uuid primary key, workspace_id uuid not null references workspaces on delete cascade,
  account_id uuid not null references accounts on delete cascade, deal_id uuid references deals on delete set null,
  title text not null, date date not null, summary text, details jsonb not null default '{}',  -- pain/requirements/risks/…
  follow_up_email text, stage_before deal_stage, stage_after deal_stage, stage_rationale text,
  raw_notes text, processed_by text, created_by uuid references users,
  created_at timestamptz default now(), updated_at timestamptz default now());
create index on meetings (account_id, date desc);
create table tasks (
  id uuid primary key, workspace_id uuid not null references workspaces on delete cascade,
  account_id uuid references accounts on delete cascade, deal_id uuid references deals on delete cascade,
  meeting_id uuid references meetings on delete set null, assignee_id uuid references users,
  title text not null, details text, due_date date, priority text not null default 'medium',
  owner task_owner not null default 'me', owner_name text, status text not null default 'open', completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create index on tasks (workspace_id, status, due_date);
-- Row-level security: every table gets  USING (workspace_id in (select workspace_id from memberships where user_id = auth.uid()))
```

Records already use globally unique string IDs and `createdAt`/`updatedAt`. That means a local workspace file can be bulk-imported into this schema as-is.

---

## 4. API

### 4.1 Service layer (what the UI calls today, in `store.js`)

| Method | Behavior |
|---|---|
| `accounts.list(filter?)` / `get(id)` / `findByName(name)` | |
| `accounts.create(data)` / `update(id, patch)` / `remove(id)` | Removing an account cascades to its deals, meetings and tasks. |
| `deals.list({accountId?, stage?})` / `get(id)` | Sorted by `position`. |
| `deals.create(data)` / `update(id, patch)` / `remove(id)` | A stage change appends to `stageHistory`. |
| `deals.move(id, stage, beforeId?)` | Drag-and-drop. Uses fractional `position` so only one row is written. |
| `meetings.list(filter?)` / `get(id)` / `update` / `remove(id, {removeTasks})` | |
| `meetings.ingest({accountId \| newAccountName, dealId \| newDealName, moveToStage, nextStep, competitors, meeting, tasks[]})` | One atomic transaction: creates the account/deal if needed, then the meeting, the tasks and the stage move. |
| `tasks.list(filter?)` / `create` / `update` / `complete(id, done)` / `remove` | Sorted open-first, then by due date, then by priority. |
| `settings.get()` / `update(patch)` | |
| `workspace.snapshot()` / `load(json, 'replace'\|'merge')` / `reset()` / `counts()` | |
| `on(listener)` | Change events `{type:'deals.update', id}` etc. |

`ai.processNotes(notes, context, {apiKey, model, effort})` returns `{ result, engine: 'ai'|'heuristic', warning? }`.

### 4.2 REST contract for the cloud backend (1:1 with the service layer)

All endpoints are under `/api/v1`, use JSON, and require a `Bearer` JWT. Each workspace is scoped by the `X-Workspace-Id` header.

| Method & path | Maps to |
|---|---|
| `GET /accounts?q=` · `POST /accounts` | `accounts.list` · `create` |
| `GET/PATCH/DELETE /accounts/:id` | `get` · `update` · `remove` |
| `GET /deals?stage=&accountId=` · `POST /deals` | `deals.list` · `create` |
| `GET/PATCH/DELETE /deals/:id` | |
| `POST /deals/:id/move` `{stage, beforeId}` | `deals.move` |
| `GET /deals/:id/history` | stage history |
| `GET /meetings?accountId=&dealId=&q=` | `meetings.list` |
| `POST /meetings/analyze` `{notes, accountId?, dealId?, meetingDate}` → analysis | `ai.processNotes` (server-side key, streaming) |
| `POST /meetings/ingest` | `meetings.ingest` (one DB transaction) |
| `GET/PATCH/DELETE /meetings/:id` | |
| `GET /tasks?status=&owner=&due_before=&accountId=` · `POST /tasks` | `tasks.list` · `create` |
| `PATCH/DELETE /tasks/:id` · `POST /tasks/:id/complete` | |
| `GET /tasks.ics?token=` | calendar feed subscription for reminders |
| `GET /workspace/export` · `POST /workspace/import` | snapshot / load, for migrating local files to the cloud |
| `GET /me` · `PATCH /me/settings` | |

Errors return `{ error: { code, message, details? } }` with 400 (validation), 401, 403, 404, 409 (version conflict via `If-Match: updatedAt`) or 429.

---

## 5. UI architecture

- **Shell (`app.js`)**: a sticky header with navigation, an overdue badge, the save-status indicator and the primary **New meeting** button. It uses a hash router (`#/pipeline`, `#/tasks`, `#/meetings`, `#/accounts`, `#/settings`) and keyboard shortcuts: `N` for a new meeting, `T` for a new task, `1`–`5` to switch views, `Alt+←/→` to move a focused deal card, and `Esc` to close panels.
- **Rendering model**: every view is a `render(root)` function that builds DOM through `h()`. Store change events trigger one re-render per animation frame. Filter input only repaints the list, never the input itself. Drawers subscribe to the store and stay live, so ticking off a task inside a deal drawer updates both the drawer and the board.
- **Pipeline**: seven columns, each with a count, a total amount and the stage definition behind (i) (the definition is also on hover). It uses native HTML5 drag and drop with an insertion marker, so you can reorder within a column or move between columns. Dropping into Closed Lost asks for a reason. Each card shows the account, amount, close date, next open task (red if overdue), task count, last meeting date and a quick "new meeting" button.
- **New meeting wizard**: works in three steps.
  1. **Capture**: pick the account/deal or let it auto-detect, set the date, then paste notes or drop `.txt/.vtt/.srt/.md/.html` files.
  2. **Process**: shows a spinner with an elapsed timer and can be cancelled.
  3. **Review**: fix the account and deal (or create new ones), see the stage recommendation with its reasoning, and get an editable action-item table (include toggle, owner, name, due date, priority). The editable meeting record covers summary, attendees, pain points, requirements, environment, risks, decisions and competitors, and there's a copyable follow-up email.
- **Tasks**: grouped as Overdue / Today / Next 7 days / Later / No date / Completed. Filters are My tasks, Others' commitments, account and search. Quick-add understands phrases like "by Friday", "next week" and "10/15", detects account names, and treats `!` as high priority. You can reschedule inline, export a task to `.ics`, and turn on desktop notifications.
- **Security**: no `innerHTML` anywhere with user or AI text. Everything uses `textContent`.

---

## 6. AI meeting analysis

- **Model**: `claude-opus-5` by default. `claude-sonnet-5` and `claude-haiku-4-5` can be picked in Settings. The request uses `output_config.format` (JSON Schema structured outputs) so the response always parses, plus `output_config.effort`.
- **Refusal fallback**: on Opus 5 the request opts into server-side `fallbacks: "default"` (beta header `server-side-fallback-2026-07-01`). If the API rejects the parameter, it retries without it. `stop_reason` is checked for `refusal` and `max_tokens` before the content is read.
- **Prompt**: the system prompt carries the Nutanix SE context, the 7 stage definitions and the rules. Only facts from the notes are used. Every action item gets an owner and a weekday due date resolved from the meeting date. A stage move is suggested only when exit criteria are met. The user turn contains the JSON context (today's date, the SE's name, and the existing accounts and deals with their IDs for matching) and the notes in `<meeting_notes>` tags.
- **Validation**: `sanitize()` re-checks enums, dates and that the matched IDs really exist.
- **Offline fallback**: `heuristicParse()` understands Zoom AI Companion sections ("Quick recap", "Next steps", "Summary"), WebVTT transcripts, speaker labels, "X will…" ownership, natural-language dates, competitor names and stage keyword signals. It runs when no key is set or when the API call fails.

---

## 7. Scaling roadmap

| Phase | Change | Touches |
|---|---|---|
| **1 — MVP (this)** | Single file, local-first, bring-your-own API key | — |
| 2 — Team sync | Node/TS API (Fastify) + Postgres (§3.4) + auth (SSO via Entra ID/Okta). `HttpAdapter` implements the same `getAll/commit/…` surface as `db.js`, with IndexedDB kept as an offline cache and an outbox for replay. | `db.js` only |
| 3 — Server-side AI | `/meetings/analyze` streams from Claude using the org's key. Adds prompt caching of the system prompt, audit logging and PII redaction policies. The browser no longer holds a key. | `ai.js` → thin client |
| 4 — Integrations | Zoom webhook (`recording.transcript_completed`) auto-drafts meetings. Two-way sync of stage and amount to Salesforce. Calendar feed, and email or Slack digests of due tasks. | new services |
| 5 — Manager views | Multi-SE workspaces, forecast roll-ups, stage-velocity analytics built from `deal_stage_history`. | new views |
