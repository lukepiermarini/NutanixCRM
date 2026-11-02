# Nutanix Deals (shared deal tracker)

`deals/deal-tracker.html` is a shared, reminders-style tracker for deals in flight and general tasks. It runs as a claude.ai artifact with a live shared database, so you and your account executive work from the same list.

- **Deals** and **Tasks** each get their own page. Tasks are one-off items without a step track.
- **Steps per deal are free-form.** You can add, rename, tick off or remove any number of them. The **+** after the last step adds steps inline: press Enter to keep adding and Esc to stop. To reorder, drag the step chips on the list, or use the grip handles in the details panel. On a phone, press and hold a step first, then drag. The first unfinished step is marked *Next*, and steps used on several deals are suggested when you add one.
- Checklist answers of **No** show in red.
- **Each step has its own date and optional time.** The *Next* step's date shows directly under its pill and turns red when overdue. Click any other step's name to show its date, or to add one, under the pill. The check box on the left of a pill ticks it on or off. Dates can also be set per step in the details panel.
- **Deals are edited in place, with no separate edit page.** Click a deal's name to rename it (the cursor shows it's text). Hover over a link and click its pencil to change the label or address, or delete it. Notes belong to steps: click a step to reveal its date and an *Add note* button. Click the post-it to edit the note, and click the step again to hide it. A small post-it mark shows which steps have notes. Delete a deal with the trash icon. The × in a step's rename box deletes the step. A new deal opens straight into adding steps.
- **Edit buttons on hover** (tasks still use the details editor): hover over a deal's name line, or anywhere on a task, and an **Edit** button appears right next to the name to open the details panel. Hover over a step and a pencil appears at its right end to rename it in place: Enter or clicking away saves, and Esc cancels. On touch screens these buttons are always shown.
- **Links**: add as many as you need. The blue **+** square after the last link opens an inline box: paste the link, add an optional label, and press Enter. Link icons are blue, and Sizer scenario IDs are shown on each link.
- **Land & Expand / Renewal**: a two-option toggle right after each deal's name. Click one to set it, and click it again to clear it.
- **Deal progress**: two stacked bars right of the Land & Expand / Renewal toggle. **Stage** has Sales Stages 1–8; clicking Stage 7 also asks for the order status, and a separate **9** control records Closed Lost or Disqualified. **Tech Close** (0–100%) sits under Stages 1–5 and ends there. Each bar is a capsule of equal-size cells with the stage number or percentage inside. Click a cell to set it, and click the current cell again to clear that bar. Stage 7's and Stage 9's menus have a *Clear* option. Hover over any cell, or tab to it, to see what that step requires and what it takes to reach the next one. The bars are keyboard operable, and they're stored on the deal as `salesStage`, `orderStatus`, `closedOutcome` and `techClose`.
- **MEDDPICC** at the bottom of every deal: eight tiles, **M E D D P I C C**, each with a 3-dot strength meter and the next step that closes its biggest gap. Hover over or tab to a letter to see what "Strong" needs, with ✓ or ○ against each criterion. Hover over a letter for a small ▾ arrow, and click it to open the evidence. Each letter gets a box directly below it with its bullets stacked as small cards you edit inline. Each bullet has a criterion, a source, who said it and a risk flag. **Add meeting notes** accepts pasted text or a `.txt`, `.md`, `.vtt` or `.srt` file and proposes bullets for you to accept, edit or reject. Nothing is saved until you apply them. The raw notes are kept on the deal so you can re-read, re-process or delete them.
  - The rubric, `scoreLetter` and `extractMeddpiccFromNotes` live in `deals/meddpicc.js`. Edit the rubric there; the UI picks it up. Strength is always calculated from the bullets, never stored.
  - Extraction is rule-based and runs in the browser. Notes are not sent to any AI service. `MEDDPICC.setExtractor(fn)` is the hook for swapping in an approved model later.
  - Data on each deal: `meddpicc` (bullets keyed by letter id: `id`, `text`, `criterion`, `source`, `who`, `risk`, `createdAt`, `updatedAt`, plus `noteDate` for bullets from notes) and `meetingNotes` (`{ id, date, attendees, text, createdAt }`). A deal is stored as one document (256 KB max), so notes that would push it past about 230 KB aren't kept; the bullets are still applied.
- **Yes/No checklist** on every deal: *Updated Nutanix Recent Notes*, *Implementation Strategy*, *Implementation Plan*. You can toggle them right on the row. On the list, the first one is labelled *Updated Recent Notes*.
- **Edit highlights**: every change records who made it and when, down to the step, link or checklist item. When someone else changes something, the next time you open the page a banner names them, the changed parts are highlighted, and the row says what changed. Highlights stay until you click *Mark seen* or *Mark all seen*. Deletions by the other person show up with a *Restore* button.

**Look:** the page follows the Nutanix brand guide. It uses Montserrat only, leads with white and Charcoal Gray (#131313), and uses Iris Purple (#7855FA) for accents and divider rules. Secondary colors appear only as small status highlights: Mantis Green (#92DD23) for done and Yes, Aqua Blue (#1FDDE9) for the other person's edits, and Peach Pink (#FF9178) for flags. The logo is not used. The page fills the full width of any window. A **Light / Dark / Auto** switch in the top bar picks the theme: Light always gives a white background, and Auto follows the system setting. The choice is remembered per browser.

The page loads `deals/meddpicc.js` from the same folder, so publish both files together.

Opened as a plain file outside claude.ai, the page falls back to a single-browser mode backed by `localStorage`. `node tests/deals-e2e.mjs` uses that mode to drive two simulated people through the whole flow in Chromium.

# SE Pipeline

A deal pipeline, meeting-notes assistant and task tracker built for **Nutanix Systems Engineers**.

- **Pipeline board**: seven stage columns (Identified Opportunity → Opportunity Discovery → Develop Opportunity → Technical Differentiation → Technical Win → Closed Won / Closed Lost). Drag cards between columns.
- **New meeting**: paste or drop your Zoom AI Companion summary, Zoom transcript (`.vtt`/`.txt`) or rough notes. It's analyzed right in your browser, with no API key and nothing sent anywhere. You get a clean summary, pain points, requirements, risks and a follow-up email draft. You also get **dated next steps with owners**, the meeting is attached to the right account and opportunity, and it suggests a stage move when the exit criteria are met.
- **Tasks & reminders**: everything you owe, grouped as Overdue / Today / Next 7 days / Later. There's natural-language quick-add, `.ics` calendar export and desktop notifications.
- **Private by design**: each person's data stays on their own PC. No server and no sign-up.

## Using it

1. Open **`dist/se-pipeline.html`** in Chrome or Edge (Firefox and Safari work too, without file auto-save).
2. **Settings → Your name**: set this once so action items that are yours ("Jordan will send the BOM") get assigned to you.
3. Recommended: **Settings → Storage → "Auto-save to a file…"** lets you pick a location such as `Documents/se-pipeline-workspace.json`. From then on every change is written to that file automatically. After a browser restart, click the yellow save indicator once to resume.
4. Click **New meeting**, paste your notes and hit **Process notes**. Review, then **Save**.

To share it, send the single `se-pipeline.html` file. Each person who opens it gets their own empty workspace. Data is never shared unless someone sends their workspace `.json` file.

Your data is always saved in the browser's storage on your PC (IndexedDB). The linked JSON file is a live copy you own: back it up, sync it with OneDrive, or use **Open workspace file…** to move to another computer. **Export backup** works in every browser.

Keyboard shortcuts: `N` new meeting · `T` new task · `1–5` switch views · `Alt+←/→` move the focused deal card · `Esc` close.

## Developing

```bash
npm run build      # → dist/se-pipeline.html (zero dependencies)
npm run dev        # rebuild on change
npm test           # unit tests (Node 18+)
node tests/e2e.mjs # browser smoke test (needs the `playwright` package)
```

The architecture, file structure, database schema, API and UI design are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Privacy:** meeting notes are analyzed locally and never leave your PC.
