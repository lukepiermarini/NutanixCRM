# SE Pipeline — Architecture

A deal pipeline, meeting-intelligence and task tracker for Nutanix Systems Engineers.

**Design goals for the MVP**

1. **Zero-install distribution.** One `.html` file you can email to a teammate. They double-click it and have their own workspace.
2. **Local-first and private.** Every user's data lives on their own PC (IndexedDB, plus an optional JSON file that auto-saves). There's no server and no login.
3. **Smart where it counts, with no API keys.** Raw Zoom notes go in; out come a summary, owners, dated action items and a stage recommendation. A built-in analyzer runs entirely in the browser, and nothing is sent anywhere.
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
│  │ api.accounts | deals | meetings | tasks | settings |     │   │ Notes analyzer    │  │
│  │ workspace   — validation (schema.js), in-memory cache,   │◄──┤ (analyzer.js)     │  │
│  │ atomic multi-entity commits, event bus                   │   │ local, rule-based │  │
│  └───────────────┬──────────────────────────────┬───────────┘   │ no network/keys   │  │
│                  │ adapter.commit(ops)          │ snapshot      └───────────────────┘  │
│  ┌───────────────▼──────────────┐   ┌───────────▼─────────────┐                        │
│  │ IndexedDB adapter (db.js)    │   │ File sync (filesync.js) │                        │
│  │ primary store, per browser   │   │ File System Access API  │                        │
│  │ profile = per person's PC    │   │ debounced JSON mirror   │                        │
│  └──────────────────────────────┘   └───────────┬─────────────┘                        │
└──────────────────────────────────────────────────┼─────────────────────────────────────┘
                                                   ▼
                                   ~/Documents/se-pipeline-workspace.json
```

**Data flow for "New meeting":**
`paste/drop notes → analyzer.processNotes()` (local, runs in milliseconds) → `sanitize()` checks the result against the contract and the IDs that really exist → **review screen** (the user edits or accepts) → `api.meetings.ingest()` does one atomic commit: creates the account/deal if needed, saves the meeting and tasks, and moves the stage → a change event re-renders the views and triggers a debounced write to the linked file.

**Key decisions**

| Decision | Why |
|---|---|
| Vanilla JS, no framework, no runtime deps | The app has to run offline from a single file forever. There are no CDN or npm supply-chain risks, and it's about 175 KB. |
| IndexedDB as the primary store | It's durable, transactional, has no size issues, and works on `file://`. `navigator.storage.persist()` asks the browser not to evict it. |
| JSON file mirror via File System Access API | This covers "saves to my PC". The user owns a real file they can back up, sync with OneDrive, or move to a new laptop. On open, the newest copy (file or browser) wins. |
| In-memory cache + event bus | Views stay synchronous and simple. A write is a single atomic IndexedDB transaction. |
| `BroadcastChannel` | Two open tabs stay consistent. |
| Human-in-the-loop review | Extracted results are never saved blindly. The user confirms the account, tasks and stage move. |
| Local rule-based analyzer instead of an LLM API | No keys to hand out, no per-user cost, and customer notes never leave the PC. Zoom AI Companion already does the heavy summarization; the analyzer structures it and turns it into owned, dated tasks. |

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
│   │   └── analyzer.js            meeting-notes analyzer: format detection, action extraction, date NLP, summary
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
│   │       └── settings.js        profile, storage/backup
│   └── app.js                     bootstrap, hash router, header, reminders
├── tests/
│   ├── core.test.mjs              unit + analyzer fixture tests (node --test)
│   ├── fixtures/                  sample Zoom summaries, transcripts, rough notes
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

Every record passes through `schema.normalize.<entity>()` on write. This covers UI input, analyzer output and imported files, so no bad data ever reaches the store.

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
           rawNotes, processedBy: 'auto'|'manual', createdAt, updatedAt }

Task     { id, title, details, dueDate, priority: 'high'|'medium'|'low',
           owner: 'me'|'account_exec'|'customer'|'partner'|'nutanix_other', ownerName,
           status: 'open'|'done', completedAt,
           accountId?, dealId?, meetingId?, createdAt, updatedAt }
```

**Pipeline stages** (defined in `schema.js`; the definitions are shown in the UI and drive the analyzer's stage recommendation):

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

`analyzer.processNotes(notes, {accounts, deals, userName, meetingDate, accountId?, dealId?})` returns the analysis synchronously: title, summary, discussion points, pain/requirements/environment/risks/decisions, competitors, attendees, action items, matched account/deal, suggested stage + rationale, follow-up email, and the detected `format`.

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
| `POST /meetings/analyze` `{notes, accountId?, dealId?, meetingDate}` → analysis | `analyzer.processNotes` (same module, run server-side) |
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
- **Security**: no `innerHTML` anywhere with user text or pasted notes. Everything uses `textContent`.

---

## 6. Meeting-notes analyzer (`src/core/analyzer.js`)

This runs fully in the browser with no API key and no network calls. It works in these stages:

1. **Clean**: normalizes every Zoom transcript layout to `Speaker: text`. That covers WebVTT cues and `<v>` tags, `Name  00:01:23` headers, `00:01:23 Name: text`, and chat exports. Smart quotes and timestamps are removed. Spoken filler ("um", "you know", repeated words) is stripped from transcripts.
2. **Detect the format**:
   - **Zoom AI Companion summary**: Quick recap, Next steps and Summary sections.
   - **Transcript**: mostly speaker lines.
   - **Notes**: anything else.
3. **Segment**: splits the text into sections (recap, summary topics, next steps, decisions, risks, pain points, requirements, environment, attendees) using heading synonyms. It finds Zoom's Title-Case topic subheadings, per-person groupings under Next steps ("Jordan Lee" followed by bullets), and the date and title from the "Meeting summary for …" line.
4. **Action items**: pulled from:
   - Next-steps lists: "X to…", "X will…", "Name: …", "[Name] …", "… (Name)", and per-person groups.
   - Commitments in the conversation: "I'll / we'll / let me …", "Dana will …".
   - Requests: "can you / please …". In a two-person call the other speaker is assigned.
   - Imperative bullets in rough notes ("need to loop in AE on pricing").

   Along the way it:
   - splits compound sentences ("I'll size it by Friday, and I'll send the TCO") into two tasks;
   - links replies like "Sure, I can get that to you tomorrow" back to the request they answer;
   - removes duplicates, and adds standard SE follow-ups (recap email, calendar invite or scheduling a follow-up meeting or workshop when one is discussed).
5. **Owners**: "me" is decided by the SE's name set in Settings, or by first person. Account Exec comes from "AE" or "account exec" mentions. Nutanix colleagues are recognized from an org in parentheses, partners from the account's partner or a list of known resellers (CDW, SHI, WWT, Presidio…), and everyone else counts as the customer.
6. **Due dates**: natural-language dates are resolved against the meeting date: today, tomorrow, EOD/EOW/EOM, by Friday, next Tuesday, early/later this/next week, in 3 business days, 10/15, Oct 20th. Without a date, the default is 1, 3 or 10 business days depending on priority (5 for customer-owned items). Weekends are skipped.
7. **Content**: sentences are classified into pain points, requirements, current environment, risks and decisions (negation-aware, so "not yet approved" is not a decision). Competitors are picked out and topics detected (VMware exit, POC, DR, NC2, NDB, VDI, Kubernetes, edge, …).
8. **Summary**: Zoom's Quick recap is used as-is and topic subsections become discussion points. For transcripts and notes, a generated opening line (account, people, topics) is followed by the highest-scoring informative sentences, attributed to their speaker.
9. **Match & recommend**: the account is matched by full or distinctive name (or suggested from the Zoom title or attendee orgs). The opportunity is matched by name overlap or as the only open deal, or a name is suggested from the main topic. The stage suggestion only moves forward, ignores hypotheticals ("might do a POC later"), and explains itself with the sentence that triggered it.

Everything is covered by fixture tests (`tests/fixtures/*`) for each input format.

---

## 7. Scaling roadmap

| Phase | Change | Touches |
|---|---|---|
| **1 — MVP (this)** | Single file, local-first, built-in analyzer | — |
| 2 — Team sync | Node/TS API (Fastify) + Postgres (§3.4) + auth (SSO via Entra ID/Okta). `HttpAdapter` implements the same `getAll/commit/…` surface as `db.js`, with IndexedDB kept as an offline cache and an outbox for replay. | `db.js` only |
| 3 — Optional LLM enrichment | A server-side `/meetings/analyze` could add an org-managed LLM on top of the rule-based analyzer, behind the same result contract, if leadership approves sending notes to one. No per-user keys. | `analyzer.js` output contract unchanged |
| 4 — Integrations | Zoom webhook (`recording.transcript_completed`) auto-drafts meetings. Two-way sync of stage and amount to Salesforce. Calendar feed, and email or Slack digests of due tasks. | new services |
| 5 — Manager views | Multi-SE workspaces, forecast roll-ups, stage-velocity analytics built from `deal_stage_history`. | new views |
