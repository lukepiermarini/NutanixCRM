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
