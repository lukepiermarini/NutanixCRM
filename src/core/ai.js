/* Meeting-notes intelligence.
 *
 * processNotes() turns raw Zoom transcripts / AI Companion summaries / scribbled
 * notes into a structured meeting record + dated action items + a stage
 * recommendation. Two engines share one output contract:
 *   - Claude (Anthropic Messages API, structured JSON output) when an API key is set
 *   - an offline heuristic parser otherwise (or if the API call fails)
 *
 * Raw fetch is used on purpose: the app ships as a single dependency-free HTML
 * file with no build-time package manager, so the SDK can't be bundled. */
(function (NX) {
  'use strict';
  const { STAGES, STAGE_IDS, OWNER_IDS, PRIORITIES } = NX.schema;
  const U = NX.util;

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODELS = [
    { id: 'claude-opus-5', label: 'Claude Opus 5 (recommended)' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (faster, lower cost)' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' },
  ];

  // ---------------------------------------------------------------------------
  // Output contract (also the JSON schema sent to Claude)
  // ---------------------------------------------------------------------------
  const strArr = { type: 'array', items: { type: 'string' } };
  const RESULT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'meetingDate', 'matchedAccountId', 'suggestedAccountName', 'matchedDealId', 'suggestedDealName',
      'attendees', 'summary', 'discussionPoints', 'painPoints', 'requirements', 'environment', 'competitors', 'risks',
      'decisions', 'actionItems', 'suggestedStage', 'stageRationale', 'dealNextStep', 'followUpEmail'],
    properties: {
      title: { type: 'string', description: 'Short meeting title, e.g. "Acme – NC2 on AWS POC kickoff"' },
      meetingDate: { type: 'string', description: 'YYYY-MM-DD if stated or inferable, else empty string' },
      matchedAccountId: { type: 'string', description: 'id of the existing account this meeting is about, or empty string' },
      suggestedAccountName: { type: 'string', description: 'Customer organization name as it appears in the notes' },
      matchedDealId: { type: 'string', description: 'id of the existing deal this meeting is about, or empty string' },
      suggestedDealName: { type: 'string', description: 'If no deal matches, a concise opportunity name; else empty string' },
      attendees: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'organization', 'role'],
          properties: { name: { type: 'string' }, organization: { type: 'string' }, role: { type: 'string' } },
        },
      },
      summary: { type: 'string', description: '3-5 sentence executive summary of what happened and why it matters' },
      discussionPoints: strArr,
      painPoints: { ...strArr, description: 'Customer pain / gain / risk statements, business drivers, metrics' },
      requirements: { ...strArr, description: 'Technical requirements, sizing, success criteria' },
      environment: { ...strArr, description: 'Current environment facts: hypervisor, hardware, workloads, versions, renewal dates' },
      competitors: strArr,
      risks: { ...strArr, description: 'Deal risks, blockers, open questions' },
      decisions: strArr,
      actionItems: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['title', 'details', 'owner', 'ownerName', 'dueDate', 'priority'],
          properties: {
            title: { type: 'string', description: 'Imperative, specific action (starts with a verb)' },
            details: { type: 'string' },
            owner: { type: 'string', enum: OWNER_IDS },
            ownerName: { type: 'string' },
            dueDate: { type: 'string', description: 'YYYY-MM-DD' },
            priority: { type: 'string', enum: PRIORITIES },
          },
        },
      },
      suggestedStage: { type: 'string', enum: [...STAGE_IDS, 'no_change'] },
      stageRationale: { type: 'string' },
      dealNextStep: { type: 'string', description: 'One-line next step for the deal card' },
      followUpEmail: { type: 'string', description: 'Ready-to-send recap email to the customer (plain text)' },
    },
  };

  function systemPrompt() {
    const stages = STAGES.map((s) => `- ${s.id} = "${s.name}": ${s.definition}`).join('\n');
    return `You are the meeting-notes analyst for a Nutanix Systems Engineer (SE). The SE pastes raw, unformatted meeting notes — usually Zoom auto-transcripts or Zoom AI Companion summaries — and you turn them into an accurate CRM record they can act on.

Nutanix context: the SE works alongside an Account Executive and channel partners, selling Nutanix Cloud Platform (AHV, AOS/NCI, Prism Central, NC2 on AWS/Azure, Nutanix Unified Storage/Files/Objects, NDB, NKP/Kubernetes, Flow, Data Lens, Move for migrations). Common drivers: VMware/Broadcom licensing changes, hardware refreshes, consolidation, DR, VDI/EUC, databases, hybrid cloud.

Pipeline stages (use the id values):
${stages}

How to work:
- Only record facts present in the notes. Never invent names, numbers, dates or commitments. If something is unclear, say so in risks rather than guessing.
- Action items are the most important output. Capture every commitment anyone made, and add the obvious SE follow-ups the notes imply (e.g. send recap, schedule next meeting, prepare sizing). Each must be concrete and start with a verb.
- owner: "me" = the SE (the person the notes belong to), "account_exec" = the Nutanix AE/sales rep, "customer", "partner", "nutanix_other" (SA, specialists, support). Put the person's name in ownerName when known.
- Every action item needs a dueDate (YYYY-MM-DD). Resolve relative dates ("by Friday", "next week", "EOM") against the meeting date. If no date was stated, pick a realistic one: recap/follow-up emails within 1 business day, internal prep before the next scheduled meeting, otherwise 3-5 business days. Never pick a weekend.
- priority: high = blocks deal progress or was promised to the customer with a date; low = nice to have.
- suggestedStage: recommend moving the deal only when the notes clearly show the exit criteria of the current stage are met (or the deal was won/lost); otherwise "no_change". Explain your reasoning in stageRationale by referencing the stage definition.
- matchedAccountId / matchedDealId: choose only from the provided lists, match on customer name (allow abbreviations/typos). Leave empty if nothing matches.
- followUpEmail: concise, professional recap addressed to the customer attendees: thanks, key takeaways, agreed next steps with owners and dates. No subject line placeholder brackets.`;
  }

  function userPrompt(notes, ctx) {
    const context = {
      today: U.todayISO(),
      meetingDateHint: ctx.meetingDate || '',
      seName: ctx.userName || '(the SE)',
      preselectedAccountId: ctx.accountId || '',
      preselectedDealId: ctx.dealId || '',
      accounts: ctx.accounts.map((a) => ({ id: a.id, name: a.name, partner: a.partner })),
      deals: ctx.deals.map((d) => ({ id: d.id, accountId: d.accountId, name: d.name, stage: d.stage })),
    };
    return `<context>\n${JSON.stringify(context, null, 1)}\n</context>\n\n<meeting_notes>\n${notes}\n</meeting_notes>\n\nAnalyze these meeting notes and return the JSON record.`;
  }

  class AIError extends Error {
    constructor(message, { status, retryable } = {}) { super(message); this.name = 'AIError'; this.status = status; this.retryable = !!retryable; }
  }

  async function callClaude({ apiKey, model, effort, notes, ctx, signal, _noFallback }) {
    const useFallbacks = !_noFallback && /^claude-(opus-5|fable-5)/.test(model);
    const body = {
      model,
      max_tokens: 16000,
      system: systemPrompt(),
      messages: [{ role: 'user', content: userPrompt(notes, ctx) }],
      output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    };
    if (effort && !/haiku/.test(model)) body.output_config.effort = effort;
    if (useFallbacks) body.fallbacks = 'default';

    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for calling the API straight from a browser page.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (useFallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';

    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new AIError('Could not reach the Claude API (network/firewall?). ' + err.message, { retryable: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || res.statusText;
      if (res.status === 400 && useFallbacks && /fallback/i.test(msg)) {
        return callClaude({ apiKey, model, effort, notes, ctx, signal, _noFallback: true });
      }
      if (res.status === 401) throw new AIError('Invalid API key — check Settings.', { status: 401 });
      if (res.status === 403) throw new AIError('API key lacks permission: ' + msg, { status: 403 });
      if (res.status === 404) throw new AIError(`Model "${model}" not available to this key: ${msg}`, { status: 404 });
      if (res.status === 429) throw new AIError('Rate limited by the Claude API — try again in a minute.', { status: 429, retryable: true });
      if (res.status >= 500) throw new AIError('Claude API is temporarily unavailable (' + res.status + ').', { status: res.status, retryable: true });
      throw new AIError('Claude API error: ' + msg, { status: res.status });
    }
    if (data.stop_reason === 'refusal') throw new AIError('Claude declined to process these notes.', { status: 200 });
    if (data.stop_reason === 'max_tokens') throw new AIError('The notes produced too long a response. Try splitting them.', { status: 200 });
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new AIError('Claude returned an unreadable response.', { status: 200, retryable: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Offline heuristic engine
  // ---------------------------------------------------------------------------
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const COMPETITORS = ['VMware', 'Broadcom', 'vSAN', 'VxRail', 'Dell APEX', 'HPE', 'SimpliVity', 'Azure Stack HCI', 'Azure Local', 'Hyper-V',
    'Pure Storage', 'NetApp', 'HyperFlex', 'Proxmox', 'OpenShift', 'Red Hat', 'Scale Computing', 'Citrix', 'Omnissa', 'Cohesity', 'Rubrik'];

  /** Strips WebVTT/SRT scaffolding so transcripts read as "Speaker: text" lines. */
  function cleanTranscript(raw) {
    return String(raw || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^WEBVTT.*$/m, '')
      .split('\n')
      .filter((l) => !/^\s*\d+\s*$/.test(l) && !/-->/.test(l))
      .map((l) => l.replace(/^\s*\[?\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\]?\s*/, '').trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Resolves natural-language due dates relative to baseDate (YYYY-MM-DD). Returns '' if none found. */
  function parseDueDate(text, baseDate) {
    const t = ' ' + String(text).toLowerCase() + ' ';
    const base = baseDate || U.todayISO();
    const baseDow = U.parseISODate(base).getDay();
    // Next occurrence of a weekday (today counts as a week away); nextWeek skips into the following week.
    const nextDow = (dow, nextWeek) => {
      const diff = (dow - baseDow + 7) % 7 || 7;
      return U.addDays(base, nextWeek && diff < 7 ? diff + 7 : diff);
    };
    const fridayOffset = (5 - baseDow + 7) % 7;
    let m;
    if (/\b(today|eod|end of (the )?day|asap|immediately)\b/.test(t)) return base;
    if (/\btomorrow\b/.test(t)) return U.addBusinessDays(base, 1);
    if ((m = t.match(/\bin (\d+|a|one|two|three) (business )?(day|week)s?\b/))) {
      const n = { a: 1, one: 1, two: 2, three: 3 }[m[1]] || Number(m[1]);
      return m[3] === 'week' ? U.addDays(base, n * 7) : (m[2] ? U.addBusinessDays(base, n) : U.addDays(base, n));
    }
    if (/\b(eow|end of (the )?week|this week)\b/.test(t)) return U.addDays(base, baseDow === 6 ? 6 : fridayOffset);
    if (/\bnext week\b/.test(t)) return U.addDays(base, baseDow === 0 || baseDow === 6 ? fridayOffset : fridayOffset + 7);
    if (/\b(eom|end of (the )?month)\b/.test(t)) {
      const d = U.parseISODate(base); return U.toLocalISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    }
    if ((m = t.match(/\bnext (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/))) return nextDow(WEEKDAYS.indexOf(m[1]), true);
    if ((m = t.match(/\b(?:by|on|before|until|this|due) (monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri)\b/))) {
      const idx = WEEKDAYS.findIndex((w) => w.startsWith(m[1]));
      return nextDow(idx, false);
    }
    if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      const b = U.parseISODate(base);
      let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : b.getFullYear();
      let d = new Date(y, Number(m[1]) - 1, Number(m[2]));
      if (!m[3] && d < b) d = new Date(y + 1, Number(m[1]) - 1, Number(m[2]));
      if (!isNaN(d) && d.getMonth() === Number(m[1]) - 1) return U.toLocalISODate(d);
    }
    const monthRe = new RegExp('\\b(' + MONTHS.map((x) => x.slice(0, 3)).join('|') + ')[a-z]*\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b');
    if ((m = t.match(monthRe))) {
      const b = U.parseISODate(base);
      const mi = MONTHS.findIndex((x) => x.startsWith(m[1]));
      let d = new Date(b.getFullYear(), mi, Number(m[2]));
      if (d < b) d = new Date(b.getFullYear() + 1, mi, Number(m[2]));
      return U.toLocalISODate(d);
    }
    return '';
  }

  const HEADINGS = [
    ['summary', /^(quick recap|summary|meeting summary|overview|recap|tl;?dr)$/],
    ['actions', /^(next steps?|action items?|actions|follow[- ]?ups?|to ?dos?|takeaways and next steps)$/],
    ['decisions', /^(decisions?( made)?|agreements?|agreed)$/],
    ['risks', /^(risks?|concerns?|blockers?|open (questions|items|issues)|issues)$/],
    ['pain', /^(pain points?|challenges?|business drivers?|drivers|problems?)$/],
    ['requirements', /^(requirements?|technical requirements?|success criteria|scope)$/],
    ['environment', /^(current environment|environment|current state|infrastructure)$/],
    ['attendees', /^(attendees|participants|present|who attended)$/],
  ];

  function detectHeading(line) {
    const l = line.replace(/^#+\s*|\*\*|__/g, '').replace(/[:\s]+$/, '').trim().toLowerCase();
    if (!l || l.split(/\s+/).length > 5) return null;
    const hit = HEADINGS.find(([, re]) => re.test(l));
    return hit ? hit[0] : null;
  }

  const bulletText = (l) => l.replace(/^\s*([-*•●◦▪]|\d+[.)]|\[[ x]\])\s*/i, '').trim();

  function heuristicParse(rawNotes, ctx) {
    const notes = cleanTranscript(rawNotes);
    const lines = notes.split('\n').map((l) => l.trim()).filter(Boolean);
    const meetingDate = ctx.meetingDate || U.todayISO();
    const sections = { summary: [], actions: [], decisions: [], risks: [], pain: [], requirements: [], environment: [], attendees: [], body: [] };
    let current = 'body';
    for (const line of lines) {
      const h = detectHeading(line);
      if (h) { current = h; continue; }
      // Inline "Heading: content"
      const inline = line.match(/^([A-Za-z ]{3,30}):\s+(.+)$/);
      if (inline && detectHeading(inline[1])) { sections[detectHeading(inline[1])].push(inline[2]); continue; }
      sections[current].push(line);
    }

    // Attendees: explicit list, or speaker labels "Name: text"
    const speakers = new Map();
    for (const l of lines) {
      const m = l.match(/^([A-Z][\w'.-]+(?: [A-Z][\w'.-]+){0,3})\s*:\s+\S/);
      if (m && !detectHeading(m[1]) && !/^(Note|Action|Todo|Next|Summary|Decision|Risk|Re|Subject|Date|Time|Topic)/i.test(m[1])) {
        speakers.set(m[1], (speakers.get(m[1]) || 0) + 1);
      }
    }
    let attendees = sections.attendees.flatMap((l) => bulletText(l).split(/[,;]/)).map((n) => n.trim()).filter(Boolean)
      .map((n) => { const [name, org] = n.split(/\s*[(\-–]\s*/); return { name: name.trim(), organization: (org || '').replace(')', '').trim(), role: '' }; });
    if (!attendees.length) attendees = [...speakers.keys()].map((name) => ({ name, organization: '', role: '' }));

    // Action items
    const ACTION_RE = /\b(action item|todo|to-do|follow[- ]up|will (send|schedule|share|provide|set ?up|review|follow|get|reach|connect|prepare|put together|draft|confirm|check|look|build|run|book|update|loop)|need(s)? to|going to (send|schedule|share|provide)|i'll|we'll|let me|next step)\b/i;
    const candidates = [...sections.actions.map(bulletText)];
    for (const l of [...sections.body, ...sections.summary]) if (ACTION_RE.test(l) && l.length < 400) candidates.push(bulletText(l));
    const userFirst = U.normalize(ctx.userName || '').split(' ')[0];
    const seen = new Set();
    const actionItems = [];
    for (let c of candidates) {
      c = c.replace(/^(action items?|next steps?|todo|ai)\s*[:\-]\s*/i, '').trim();
      if (c.length < 6) continue;
      const key = U.normalize(c).slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      let owner = 'me', ownerName = '';
      const speaker = c.match(/^([A-Z][\w'.-]+(?: [A-Z][\w'.-]+)?)\s*:\s*(.+)$/);
      if (speaker) { ownerName = speaker[1]; c = speaker[2]; }
      const who = c.match(/^([A-Z][\w'.-]+(?: [A-Z][\w'.-]+)?)\s+(will|to|should|needs to|is going to)\b/);
      if (who && !/^(We|I|They|Team|Customer|Partner|Nutanix)$/.test(who[1])) { ownerName = who[1]; c = c.slice(who[0].length).trim(); }
      const lower = c.toLowerCase();
      if (/^(i|i'll|we|we'll|let me)\b/i.test(c) || (userFirst && U.normalize(ownerName).startsWith(userFirst))) owner = 'me';
      else if (/\b(customer|client|they will|their team)\b/.test(lower)) owner = 'customer';
      else if (/\bpartner\b/.test(lower)) owner = 'partner';
      else if (/\b(ae|account exec|account executive|sales rep)\b/.test(lower)) owner = 'account_exec';
      else if (ownerName) owner = 'customer';
      const priority = /\b(asap|urgent|critical|blocker|must|immediately|today|tomorrow)\b/i.test(c) ? 'high'
        : /\b(nice to have|eventually|when possible|at some point)\b/i.test(c) ? 'low' : 'medium';
      const title = c.replace(/^(i'll|i will|we'll|we will|let me)\s+/i, '').replace(/^\w/, (x) => x.toUpperCase()).replace(/[.;]\s*$/, '');
      const due = parseDueDate(c, meetingDate) || U.addBusinessDays(meetingDate, priority === 'high' ? 1 : priority === 'low' ? 10 : 3);
      actionItems.push({ title: title.slice(0, 240), details: '', owner, ownerName, dueDate: due, priority });
    }
    if (!actionItems.some((a) => /recap|summary|follow[- ]?up email/i.test(a.title))) {
      actionItems.unshift({ title: 'Send meeting recap and next steps to attendees', details: '', owner: 'me', ownerName: ctx.userName || '', dueDate: U.addBusinessDays(meetingDate, 1), priority: 'high' });
    }

    const body = [...sections.body, ...sections.summary];
    const grab = (re) => [...new Set(body.filter((l) => re.test(l)).map(bulletText))].slice(0, 8);
    const painPoints = [...sections.pain.map(bulletText), ...grab(/\b(pain|challeng|struggl|frustrat|problem|issue|too (slow|expensive)|cost|renewal|end of (life|support)|eol|licens|broadcom|price increase)\b/i)];
    const risks = [...sections.risks.map(bulletText), ...grab(/\b(risk|concern|blocker|worried|budget|not sure|unclear|delay|push(ed)? out|competit)\b/i)];
    const requirements = [...sections.requirements.map(bulletText), ...grab(/\b(require|must have|need(s)? (to support|to have)|success criteria|rpo|rto|tb|cores|vms?\b|nodes?)\b/i)];
    const environment = [...sections.environment.map(bulletText), ...grab(/\b(currently|today they|running on|vsphere|esxi|vcenter|hyper-v|dell|hpe|cisco|lenovo|san|netapp|pure)\b/i)];
    const decisions = [...sections.decisions.map(bulletText), ...grab(/\b(agreed|decided|decision|approved|signed off)\b/i)];
    const competitors = COMPETITORS.filter((c) => new RegExp('\\b' + c.replace(/\s+/g, '\\s+') + '\\b', 'i').test(notes));

    const summarySrc = sections.summary.length ? sections.summary.join(' ') : body.slice(0, 6).join(' ');
    const summary = summarySrc.split(/(?<=[.!?])\s+/).slice(0, 5).join(' ').slice(0, 1200);

    // Account / deal matching by name frequency
    const normNotes = ' ' + U.normalize(notes) + ' ';
    let matchedAccountId = ctx.accountId || '';
    if (!matchedAccountId) {
      let best = 0;
      for (const a of ctx.accounts) {
        const n = U.normalize(a.name);
        if (!n) continue;
        const count = normNotes.split(' ' + n + ' ').length - 1;
        if (count > best) { best = count; matchedAccountId = a.id; }
      }
    }
    let matchedDealId = ctx.dealId || '';
    if (!matchedDealId && matchedAccountId) {
      const acctDeals = ctx.deals.filter((d) => d.accountId === matchedAccountId && STAGES.find((s) => s.id === d.stage).open);
      // Score each open deal by how many of its distinctive name words appear in the notes.
      const scored = acctDeals.map((d) => {
        const words = [...new Set(U.normalize(d.name).split(' ').filter((w) => w.length > 2))];
        return { d, score: words.filter((w) => normNotes.includes(' ' + w + ' ')).length };
      }).sort((a, b) => b.score - a.score);
      const best = scored[0] && scored[0].score >= 2 && (!scored[1] || scored[1].score < scored[0].score) ? scored[0].d : null;
      matchedDealId = (best || (acctDeals.length === 1 ? acctDeals[0] : null) || {}).id || '';
    }

    // Stage suggestion from strong keyword signals only
    const deal = ctx.deals.find((d) => d.id === matchedDealId);
    const currentOrder = deal ? STAGES.find((s) => s.id === deal.stage).order : 0;
    const SIGNALS = [
      ['closed_won', /\b(po (received|issued)|purchase order (received|issued|signed)|signed the (order|contract|quote)|closed won)\b/i],
      ['closed_lost', /\b(went with|chose|selected) (vmware|broadcom|dell|hpe|microsoft|azure|another vendor|a competitor)|\bclosed lost\b|no longer (moving forward|pursuing)/i],
      ['tech_win', /\b(technical win|tech win|approved the (design|config|configuration|architecture)|signed off on the (design|config|bom)|poc (was )?successful|met (all )?(the )?success criteria)\b/i],
      ['tech_diff', /\b(poc|proof of concept|pilot|success criteria|sizing|bom|bill of materials|configuration|test drive)\b/i],
      ['develop', /\b(stakeholders?|decision makers?|timeline|budget (approved|cycle)|requirements (gathering|workshop)|procurement)\b/i],
      ['discovery', /\b(pain points?|metrics|business case|why change|current costs?|tco|roi)\b/i],
    ];
    let suggestedStage = 'no_change', stageRationale = 'No clear exit-criteria signals found in the notes.';
    for (const [stage, re] of SIGNALS) {
      const m = notes.match(re);
      const order = STAGES.find((s) => s.id === stage).order;
      if (m && deal && (order > currentOrder || stage === 'closed_lost')) {
        if (stage === deal.stage) break;
        suggestedStage = stage;
        stageRationale = `Notes mention "${m[0]}", which matches the ${STAGES.find((s) => s.id === stage).name} stage criteria. Please verify before moving.`;
        break;
      }
    }

    const acct = ctx.accounts.find((a) => a.id === matchedAccountId);
    const firstLine = sections.summary[0] ? bulletText(sections.summary[0]).split(/[.!?]/)[0] : '';
    const topic = firstLine && firstLine.length <= 70 && !(acct && U.normalize(firstLine).startsWith(U.normalize(acct.name))) ? firstLine : 'Meeting ' + U.formatDate(meetingDate, { month: 'short', day: 'numeric' });
    const title = (acct ? acct.name + ' – ' : '') + topic;
    const mine = actionItems.filter((a) => a.owner === 'me');
    const followUpEmail = [
      'Hi all,', '',
      'Thank you for your time today. A quick recap:', '',
      summary || '(summary)', '',
      'Next steps:',
      ...actionItems.map((a) => `• ${a.title}${a.ownerName ? ' (' + a.ownerName + ')' : ''} – by ${U.formatDate(a.dueDate, { month: 'short', day: 'numeric' })}`),
      '', 'Please let me know if I missed anything.', '', 'Best regards,', ctx.userName || '',
    ].join('\n');

    return {
      title,
      meetingDate: ctx.meetingDate || '',
      matchedAccountId, suggestedAccountName: acct ? acct.name : '',
      matchedDealId, suggestedDealName: '',
      attendees, summary,
      discussionPoints: body.filter((l) => l.length > 25 && !ACTION_RE.test(l)).slice(0, 8).map(bulletText),
      painPoints: [...new Set(painPoints)].slice(0, 8),
      requirements: [...new Set(requirements)].slice(0, 8),
      environment: [...new Set(environment)].slice(0, 8),
      competitors, risks: [...new Set(risks)].slice(0, 8), decisions: [...new Set(decisions)].slice(0, 8),
      actionItems,
      suggestedStage, stageRationale,
      dealNextStep: mine[0] ? mine[0].title : (actionItems[0] || {}).title || '',
      followUpEmail,
    };
  }

  // ---------------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------------
  /** Coerces any engine output to the contract (defends against partial / odd AI output). */
  function sanitize(r, ctx) {
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    const arr = (v) => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);
    const base = ctx.meetingDate || U.todayISO();
    const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
    const accountOk = ctx.accounts.some((a) => a.id === r.matchedAccountId);
    const dealOk = ctx.deals.some((d) => d.id === r.matchedDealId && (!accountOk || d.accountId === r.matchedAccountId));
    return {
      title: s(r.title) || 'Meeting',
      meetingDate: iso(r.meetingDate) || base,
      matchedAccountId: accountOk ? r.matchedAccountId : '',
      suggestedAccountName: s(r.suggestedAccountName),
      matchedDealId: dealOk ? r.matchedDealId : '',
      suggestedDealName: s(r.suggestedDealName),
      attendees: (Array.isArray(r.attendees) ? r.attendees : []).filter((a) => a && s(a.name))
        .map((a) => ({ name: s(a.name), organization: s(a.organization), role: s(a.role) })),
      summary: s(r.summary),
      discussionPoints: arr(r.discussionPoints), painPoints: arr(r.painPoints), requirements: arr(r.requirements),
      environment: arr(r.environment), competitors: arr(r.competitors), risks: arr(r.risks), decisions: arr(r.decisions),
      actionItems: (Array.isArray(r.actionItems) ? r.actionItems : []).filter((a) => a && s(a.title)).map((a) => ({
        title: s(a.title), details: s(a.details),
        owner: OWNER_IDS.includes(a.owner) ? a.owner : 'me', ownerName: s(a.ownerName),
        dueDate: iso(a.dueDate) || U.addBusinessDays(base, 3),
        priority: PRIORITIES.includes(a.priority) ? a.priority : 'medium',
      })),
      suggestedStage: [...STAGE_IDS, 'no_change'].includes(r.suggestedStage) ? r.suggestedStage : 'no_change',
      stageRationale: s(r.stageRationale),
      dealNextStep: s(r.dealNextStep),
      followUpEmail: s(r.followUpEmail),
    };
  }

  /**
   * @param {string} notes raw notes / transcript
   * @param {{accounts, deals, userName, meetingDate, accountId, dealId}} ctx
   * @param {{apiKey, model, effort, signal, forceOffline}} opts
   * @returns {Promise<{result, engine: 'ai'|'heuristic', warning?: string}>}
   */
  async function processNotes(notes, ctx, opts = {}) {
    if (!String(notes || '').trim()) throw new Error('Paste or drop your meeting notes first');
    if (opts.apiKey && !opts.forceOffline) {
      try {
        const raw = await callClaude({ apiKey: opts.apiKey, model: opts.model || 'claude-opus-5', effort: opts.effort, notes: cleanTranscript(notes), ctx, signal: opts.signal });
        return { result: sanitize(raw, ctx), engine: 'ai' };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        return { result: sanitize(heuristicParse(notes, ctx), ctx), engine: 'heuristic', warning: err.message + ' Used the offline parser instead.' };
      }
    }
    return { result: sanitize(heuristicParse(notes, ctx), ctx), engine: 'heuristic' };
  }

  /** Minimal request to verify a key/model combination from Settings. */
  async function testConnection({ apiKey, model }) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || res.statusText);
    return data.model;
  }

  NX.ai = { MODELS, RESULT_SCHEMA, processNotes, heuristicParse, cleanTranscript, parseDueDate, sanitize, testConnection, systemPrompt };
})(globalThis.NX = globalThis.NX || {});
