/* Meeting-notes analyzer — runs entirely in the browser, no API keys, no network.
 *
 * Input:  whatever the SE pastes — a Zoom AI Companion summary, a Zoom transcript
 *         (.vtt / .txt / copied from the web player), or rough notes.
 * Output: a structured meeting record (summary, topics, pain points, requirements,
 *         environment, risks, decisions, competitors), dated action items with owners,
 *         the matching account / opportunity, a stage recommendation and a
 *         follow-up email draft.
 *
 * Pipeline:  clean → detect format → segment into sections/topics/utterances
 *            → extract actions → classify sentences → summarize → match & recommend. */
(function (NX) {
  'use strict';
  const { STAGES, STAGE_IDS, OWNER_IDS, PRIORITIES } = NX.schema;
  const U = NX.util;

  // =========================================================================
  // Vocabulary
  // =========================================================================
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  const COMPETITORS = ['VMware', 'Broadcom', 'vSAN', 'VCF', 'VxRail', 'Dell APEX', 'PowerFlex', 'HPE SimpliVity', 'SimpliVity', 'GreenLake', 'Azure Stack HCI',
    'Azure Local', 'Hyper-V', 'Pure Storage', 'NetApp', 'HyperFlex', 'Proxmox', 'OpenShift', 'Red Hat', 'Scale Computing', 'Citrix',
    'Omnissa', 'Cohesity', 'Rubrik', 'StarWind', 'Platform9', 'Oracle OLVM'];

  const PARTNERS = ['cdw', 'shi', 'wwt', 'world wide technology', 'presidio', 'insight', 'carahsoft', 'eplus', 'optiv', 'sirius', 'converge',
    'trace3', 'ahead', 'softchoice', 'connection', 'zones', 'computacenter', 'softwareone', 'crayon', 'logicalis', 'dataprise', 'tdsynnex', 'td synnex', 'arrow'];

  // Topic labels used to describe what a meeting was about (and to name new opportunities).
  const TOPICS = [
    { label: 'VMware / Broadcom exit', deal: 'VMware migration', re: /\b(vmware|broadcom|vsphere|esxi|vcenter|vsan|vcf)\b/i },
    { label: 'POC planning', deal: 'POC', re: /\b(poc|proof of concept|pilot|test ?drive)\b/i },
    { label: 'migration planning', deal: 'Migration', re: /\b(migrat\w*|nutanix move|cutover|move tool)\b/i },
    { label: 'disaster recovery', deal: 'DR solution', re: /\b(dr|disaster recovery|failover|rpo|rto|replication|metro|business continuity)\b/i },
    { label: 'hardware refresh', deal: 'Infrastructure refresh', re: /\b(refresh|end of life|eol|end of support|aging hardware|out of warranty)\b/i },
    { label: 'pricing & licensing', deal: '', re: /\b(pricing|price|quote|licens\w*|cost|budget|tco|roi|subscription)\b/i },
    { label: 'timeline & decision process', deal: '', re: /\b(timeline|deadline|fiscal|fy\d\d|q[1-4]|procurement|approval|sign[- ]?off|decision makers?|renewal date)\b/i },
    { label: 'hybrid cloud (NC2)', deal: 'NC2 hybrid cloud', re: /\b(nc2|aws|azure|gcp|hybrid cloud|public cloud|cloud clusters)\b/i },
    { label: 'databases (NDB)', deal: 'Database platform (NDB)', re: /\b(ndb|database|sql server|oracle|postgres\w*|mysql|mongodb)\b/i },
    { label: 'VDI / EUC', deal: 'VDI', re: /\b(vdi|citrix|horizon|omnissa|euc|virtual desktops?)\b/i },
    { label: 'Kubernetes / containers', deal: 'Kubernetes platform', re: /\b(kubernetes|k8s|nkp|containers?|openshift)\b/i },
    { label: 'unified storage (Files/Objects)', deal: 'Unified storage', re: /\b(nutanix files|objects|file shares?|nas|s3|unified storage|nus)\b/i },
    { label: 'backup & security', deal: '', re: /\b(backup|ransomware|security|flow|microsegmentation|veeam|commvault|rubrik|cohesity|immutable)\b/i },
    { label: 'sizing & architecture', deal: '', re: /\b(sizing|bom|bill of materials|nodes?|cores|capacity|architecture|design|collector|rvtools|lift)\b/i },
    { label: 'AI / GPU workloads', deal: 'GPT-in-a-Box / AI', re: /\b(gpu|gpt[- ]in[- ]a[- ]box|llm|genai|ai workloads?|inference)\b/i },
    { label: 'edge / ROBO sites', deal: 'Edge / ROBO', re: /\b(edge|robo|remote (sites|offices)|branch(es)?|plants?|stores)\b/i },
  ];

  const SECTION_HEADINGS = [
    ['recap', /^(quick recap|recap|tl;?dr|overview|executive summary|meeting summary|summary of (the )?meeting|meeting overview)$/],
    ['summary', /^(summary|details|discussion|discussion points|discussion summary|notes|meeting notes|key (points|takeaways)|highlights|topics( discussed)?|agenda)$/],
    ['actions', /^(next steps?|action items?|actions?|follow[- ]?ups?|to ?-?dos?|tasks|takeaways and next steps|open action items|assignments|owners)$/],
    ['decisions', /^(decisions?( made)?|agreements?|agreed|outcomes?)$/],
    ['risks', /^(risks?|concerns?|blockers?|open (questions|items|issues)|issues|objections|questions)$/],
    ['pain', /^(pain points?|challenges?|business (drivers?|challenges?|problems?)|drivers|problems?|why change|why now)$/],
    ['requirements', /^((technical )?requirements?|success criteria|scope|use cases?|goals?|objectives?)$/],
    ['environment', /^(current (environment|state|infrastructure|setup)|environment|infrastructure|as-?is)$/],
    ['attendees', /^(attendees|participants|present|who attended|invitees|people)$/],
    ['competition', /^(competition|competitors|competitive( landscape)?)$/],
  ];

  const ACTION_VERBS = 'send|share|provide|get|set ?up|schedule|follow up|put together|prepare|draft|review|reach out|loop in|connect|book|confirm|check|look into|find out|update|build|run|create|work on|circle back|coordinate|test|validate|ship|deliver|order|quote|price|size|write|document|email|call|ping|introduce|arrange|organize|finalize|kick off|start|deploy|install|configure|migrate|demo|present|walk (?:them |you |us )?through|gather|collect|pull|export|upload|submit|sign|approve|evaluate|investigate|research|escalate|open|file|engage|invite|align|compile|summarize|forward|clarify|verify|identify|determine|define|finish|complete|go over|dig into|double[- ]check|touch base|sync|bring|ask|request|let (?:you|them|us|everyone) know|follow|return|obtain|secure|socialize|present|plan|draft|model|calculate|estimate|benchmark|assess|audit|map|outline|propose|recommend|set';
  const VERBS_RE = `(?:${ACTION_VERBS})`;
  const NAME_RE = "[A-Z][\\w'’.&-]*(?:\\s+(?:[A-Z][\\w'’.&-]*|de|van|von|da|di|la|le))*";
  const PRONOUNS = /^(i|we|you|they|he|she|it|this|that|there|here|these|those|everyone|someone|somebody|anyone|all|the|a|an|so|and|but|then|also|okay|ok|yes|yeah|great|thanks|thank|let's|lets|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|next|january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|fy\d*|poc|dr|nc2|ahv|aos|vmware|nutanix|prism|epic|aws|azure)$/i;

  const NOT_ACTION = /\b(can you (hear|see)|see my screen|share my screen|sharing my screen|stop sharing|on mute|i'll be honest|i will say|i'll say|we'll see|we will see|let me (know|think|see|just|pull (that |it )?up|introduce|start|jump|go back|share my|take a look at this|show you)|i can see|i can hear|i'll let you|let's get started|i'll hand it|i will hand|already (sent|did|done|shared|provided))\b/i;
  const FIRST_PERSON_RE = new RegExp(`\\b(i|we)(?:'ll| will| can| am going to|'m going to| are going to|'re going to| need to| should| have to| owe| plan to| want to| would like to| are to)\\s+(?:go ahead and |try to |also |then |just |quickly |definitely |probably |make sure to |get you |get )?${VERBS_RE}\\b`, 'i');
  const LET_ME_RE = new RegExp(`\\blet me\\s+(?:go ahead and |also |just )?${VERBS_RE}\\b`, 'i');
  const THIRD_RE = new RegExp(`\\b(${NAME_RE})(?:\\s*\\(([^)]+)\\))?\\s+(?:will|to|shall|should|needs? to|has to|have to|is going to|are going to|agreed to|committed to|volunteered to|offered to|plans? to|is to|are to|owes?)\\s+(?:go ahead and |also |then |try to |get )?${VERBS_RE}\\b`);
  const REQUEST_RE = new RegExp(`\\b(?:can|could|would) you(?: please| guys| all| folks)?\\s+(?:also |just )?${VERBS_RE}\\b|\\bplease\\s+${VERBS_RE}\\b`, 'i');
  const IMPERATIVE_RE = new RegExp(`^(?:(?:we |i )?(?:need|needs|have|has) to |must |should |todo:?\\s*|to-?do:?\\s*|follow[- ]up:?\\s+(?:on |with )?)?${VERBS_RE}\\b`, 'i');
  const MARKER_RE = /^(?:action items?|next steps?|to-?do|todo|ai|follow[- ]?up|task|owner)\s*[:\-–]\s*/i;

  // =========================================================================
  // Dates
  // =========================================================================
  /** Resolves natural-language due dates relative to baseDate (YYYY-MM-DD). Returns '' if none found. */
  function parseDueDate(text, baseDate) {
    const t = ' ' + String(text).toLowerCase() + ' ';
    const base = baseDate || U.todayISO();
    const baseDow = U.parseISODate(base).getDay();
    const nextDow = (dow, nextWeek) => {
      const diff = (dow - baseDow + 7) % 7 || 7;
      return U.addDays(base, nextWeek && diff < 7 ? diff + 7 : diff);
    };
    const fridayOffset = (5 - baseDow + 7) % 7;
    const mondayNext = (1 - baseDow + 7) % 7 || 7;
    let m;
    if (/\b(today|tonight|eod|cob|end of (the )?day|asap|immediately|right away)\b/.test(t)) return base;
    if (/\btomorrow\b/.test(t)) return U.addBusinessDays(base, 1);
    if ((m = t.match(/\bin (\d+|a|one|two|three|a couple(?: of)?) (business |working )?(day|week)s?\b/))) {
      const n = { a: 1, one: 1, two: 2, three: 3, 'a couple': 2, 'a couple of': 2 }[m[1]] || Number(m[1]);
      return m[3] === 'week' ? U.addDays(base, n * 7) : (m[2] ? U.addBusinessDays(base, n) : U.addDays(base, n));
    }
    if (/\blater this week\b/.test(t)) return U.addDays(base, baseDow >= 4 && baseDow <= 5 ? fridayOffset : Math.max(0, (4 - baseDow + 7) % 7));
    if (/\b(eow|end of (the )?week|this week)\b/.test(t)) return U.addDays(base, baseDow === 6 ? 6 : fridayOffset);
    if (/\bearly next week\b/.test(t)) return U.addDays(base, mondayNext + 1);
    if (/\bnext week\b/.test(t)) return U.addDays(base, baseDow === 0 || baseDow === 6 ? fridayOffset : fridayOffset + 7);
    if (/\b(eom|end of (the )?month)\b/.test(t)) {
      const d = U.parseISODate(base); return U.toLocalISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    }
    if (/\bnext month\b/.test(t)) return U.addDays(base, 30);
    if ((m = t.match(/\bnext (monday|tuesday|wednesday|thursday|friday)\b/))) return nextDow(WEEKDAYS.indexOf(m[1]), true);
    if ((m = t.match(/\b(?:by|on|before|until|this|due|for|next) (monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thur?s?|fri)\b/)) ||
        (m = t.match(/\b(monday|tuesday|wednesday|thursday|friday)\b/))) {
      const idx = WEEKDAYS.findIndex((w) => w.startsWith(m[1].slice(0, 3)));
      return nextDow(idx, false);
    }
    if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      const b = U.parseISODate(base);
      const y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : b.getFullYear();
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

  const DATE_PHRASE_RE = new RegExp('\\s*,?\\s*\\b(?:by|before|on|no later than|due|until|for|sometime)?\\s*(?:the\\s+)?(?:' + [
    'end of (?:the )?(?:day|week|month)', 'eod', 'eow', 'eom', 'cob', 'asap', 'today', 'tonight', 'tomorrow', 'right away',
    '(?:early |later |sometime )?(?:next|this) (?:week|month)', 'next (?:mon|tues|wednes|thurs|fri)day', '(?:mon|tues|wednes|thurs|fri)day',
    'in (?:\\d+|a|one|two|three|a couple(?: of)?) (?:business |working )?(?:days?|weeks?)',
    '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.? \\d{1,2}(?:st|nd|rd|th)?', '\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?',
  ].join('|') + ')\\b', 'gi');

  const HAS_DATE_RE = new RegExp(DATE_PHRASE_RE.source, 'i');

  // =========================================================================
  // Text preparation
  // =========================================================================
  const isNameLike = (s) => new RegExp(`^${NAME_RE}$`).test(s) && s.split(/\s+/).length <= 4 && !detectHeading(s) && !PRONOUNS.test(s);

  /** Normalizes Zoom transcript layouts (WebVTT, "Name 00:01:23", "00:01:23 Name: text", chat) to "Speaker: text" lines. */
  function cleanTranscript(raw) {
    const src = String(raw || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
    const TS_ONLY = /^\[?\(?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\)?\]?$/;
    const out = [];
    let pending = null;
    for (let line of src.split('\n')) {
      line = line.trim();
      if (/^WEBVTT/.test(line) || /^NOTE\b/.test(line) || /-->/.test(line) || /^\d+$/.test(line)) continue;
      line = line.replace(/<v\s+([^>]+)>/g, '$1: ').replace(/<\/?[a-z][^>]*>/gi, '').trim();
      if (!line) { pending = null; out.push(''); continue; }
      if (TS_ONLY.test(line)) {
        if (out.length && isNameLike(out[out.length - 1])) pending = out.pop();
        continue;
      }
      let m = line.match(new RegExp(`^\\[?(${NAME_RE})\\]?\\s+\\(?\\[?\\d{1,2}:\\d{2}(?::\\d{2})?\\]?\\)?$`));
      if (m && m[1].split(/\s+/).length <= 4) { pending = m[1]; continue; }
      m = line.match(/^\[?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\]?\s+(?:From\s+)?([^:]{2,60}?)(?:\s+to\s+[^:]+)?\s*:\s+(.*)$/);
      if (m) { out.push(`${m[1].trim()}: ${m[2]}`); pending = null; continue; }
      line = line.replace(/^\[?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\]?\s*[-–]?\s*/, '');
      out.push(pending ? `${pending}: ${line}` : line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Removes verbal filler from spoken transcript text. */
  function deFiller(s) {
    return String(s)
      .replace(/\b(um+|uh+|erm+|hmm+|mhm|uh-huh)\b[,.]?/gi, '')
      .replace(/\b(you know|i mean|sort of|kind of|basically|literally)\b,?/gi, '')
      .replace(/(^|[,.]\s*)(so|okay|ok|yeah|yes|right|well|and)[,\s]+(?=\w)/gi, '$1')
      .replace(/\blike,\s*/gi, '')
      .replace(/\b(\w+)(\s+\1\b)+/gi, '$1')
      .replace(/\s+([,.!?])/g, '$1').replace(/,{2,}/g, ',').replace(/\s{2,}/g, ' ')
      .replace(/^[,.\s]+/, '').trim()
      .replace(/^\w/, (c) => c.toUpperCase())
      .replace(/([.!?]\s+)([a-z])/g, (m0, a, b) => a + b.toUpperCase());
  }

  const stripBullet = (l) => String(l).replace(/^\s*(?:[-*•●◦▪▫‣⁃–—>]+|\d{1,2}[.)]|[a-z][.)](?=\s)|\[[ xX]?\]|☐|☑|✅|✔)\s*/, '').trim();
  const isBullet = (l) => /^\s*(?:[-*•●◦▪▫‣⁃–—]|\d{1,2}[.)]|\[[ xX]?\]|☐|☑|✅|✔)\s*/.test(l);
  const stripMd = (l) => String(l).replace(/^#{1,6}\s*/, '').replace(/\*\*|__|`/g, '').trim();

  function detectHeading(line) {
    const l = stripMd(line).replace(/[:\s]+$/, '').trim().toLowerCase();
    if (!l || l.split(/\s+/).length > 6) return null;
    const hit = SECTION_HEADINGS.find(([, re]) => re.test(l));
    return hit ? hit[0] : null;
  }

  function splitSentences(text) {
    return String(text).replace(/\s+/g, ' ').trim()
      .split(/(?<=[.!?])\s+(?=["(\[]?[A-Z0-9])/)
      .map((s) => s.trim()).filter((s) => s.length > 1);
  }

  const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);
  const STOP = new Set(('the a an and or to of for in on at by with from we i you they them these those it is are be will this that our your their as so up out over about into ' +
    'send share draft provide get set make put together follow review also well').split(' '));
  const tokens = (s) => new Set(U.normalize(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let inter = 0; for (const w of A) if (B.has(w)) inter++;
    return inter / Math.min(A.size, B.size);
  }
  const uniqueBy = (items, key, threshold = 0.75) => {
    const out = [];
    for (const it of items) if (!out.some((o) => similarity(key(o), key(it)) >= threshold)) out.push(it);
    return out;
  };
  const trimTo = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…');

  // =========================================================================
  // Segmentation
  // =========================================================================
  function isTopicTitle(line, next) {
    const s = stripMd(line);
    const w = words(s);
    if (w.length < 2 || w.length > 10 || s.length > 80 || /[.!?,;]$/.test(s) || !/^[A-Z0-9]/.test(s)) return false;
    if (/^#{1,6}\s/.test(line) || /^\*\*.+\*\*:?$/.test(line.trim())) return true;
    if (!next || stripMd(next).length < Math.max(40, s.length + 10)) return false;
    const caps = w.filter((x) => x.length > 3).filter((x) => /^[A-Z0-9]/.test(x)).length;
    const long = w.filter((x) => x.length > 3).length || 1;
    return caps / long >= 0.6;
  }

  function isAssigneeHeader(line, next) {
    const s = stripMd(line).replace(/:$/, '').trim();
    if (!next || s.length > 50) return false;
    return new RegExp(`^(?:${NAME_RE})(?:\\s*\\([^)]*\\))?(?:\\s+(?:team|side))?$`).test(s) && s.split(/\s+/).length <= 5 && !PRONOUNS.test(s);
  }

  const SPEAKER_LINE = new RegExp(`^(${NAME_RE}|[A-Z]{2,}[\\w ]{0,30})\\s*:\\s+(.+)$`);

  function segment(text) {
    const lines = text.split('\n');
    const doc = { title: '', titleDate: '', format: 'notes', sections: {}, topics: [], actionLines: [], utterances: [], attendees: [],
      headLines: lines.filter((l) => l.trim()).slice(0, 4) };
    const nonEmpty = lines.filter((l) => l.trim());
    const speakerCount = nonEmpty.filter((l) => {
      const m = l.match(SPEAKER_LINE); return m && !detectHeading(m[1]) && m[1].split(/\s+/).length <= 4;
    }).length;
    const isTranscript = nonEmpty.length >= 4 && speakerCount / nonEmpty.length >= 0.5;
    const nextLine = (i) => { for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j].trim(); return ''; };
    const push = (sec, v) => (doc.sections[sec] = doc.sections[sec] || []).push(v);

    let section = 'body', topic = null, assignee = '';
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line) continue;
      const next = nextLine(i);

      const titleM = stripMd(line).match(/^meeting (?:summary|notes|recap) (?:for|with|[-–:])\s*(.+)$/i);
      if (titleM && !doc.title) {
        let t = titleM[1];
        const dm = t.match(/\(?\b(\d{1,2}\/\d{1,2}\/\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4})\b\)?/i);
        if (dm) { doc.titleDate = dm[1]; t = t.replace(dm[0], ''); }
        doc.title = t.replace(/[\s\-–:|]+$/, '').trim();
        continue;
      }
      const hd = detectHeading(line);
      if (hd) { section = hd; topic = null; assignee = ''; continue; }
      const inline = stripMd(line).match(/^([A-Za-z][A-Za-z /&-]{2,30}):\s+(.+)$/);
      if (inline && detectHeading(inline[1])) {
        const sec = detectHeading(inline[1]);
        if (sec === 'actions') doc.actionLines.push({ text: inline[2], assignee: '' });
        else push(sec, inline[2]);
        continue;
      }

      if (section === 'actions') {
        if (!isBullet(raw) && isAssigneeHeader(line, next) && (isBullet(next) || !isAssigneeHeader(next, 'x'))) {
          assignee = stripMd(line).replace(/:$/, '').trim(); continue;
        }
        doc.actionLines.push({ text: stripMd(line), assignee });
        continue;
      }
      if (section === 'attendees') { doc.attendees.push(...stripBullet(line).split(/[,;]/).map((x) => x.trim()).filter(Boolean)); continue; }

      if (isTranscript) {
        const m = line.match(SPEAKER_LINE);
        if (m && !detectHeading(m[1])) {
          const last = doc.utterances[doc.utterances.length - 1];
          if (last && last.speaker === m[1]) last.text += ' ' + m[2];
          else doc.utterances.push({ speaker: m[1], text: m[2] });
          continue;
        }
        if (doc.utterances.length && section === 'body') { doc.utterances[doc.utterances.length - 1].text += ' ' + line; continue; }
      }

      if ((section === 'summary' || section === 'body') && !isBullet(raw) && isTopicTitle(line, next)) {
        topic = { title: stripMd(line).replace(/:$/, ''), lines: [] };
        doc.topics.push(topic);
        continue;
      }
      if (topic && (section === 'summary' || section === 'body')) topic.lines.push(stripBullet(stripMd(line)));
      push(section, stripBullet(stripMd(line)));
    }
    const hasZoomShape = doc.sections.recap || (doc.actionLines.length && (doc.topics.length || doc.sections.summary));
    doc.format = isTranscript ? 'transcript' : hasZoomShape ? 'summary' : 'notes';
    return doc;
  }

  // =========================================================================
  // People & owners
  // =========================================================================
  function buildPeople(doc, ctx) {
    const people = new Map(); // normalized name -> { name, organization, side }
    const acct = ctx.account;
    const partnerNames = [...PARTNERS, U.normalize(acct && acct.partner)].filter(Boolean);
    const sideOfOrg = (org) => {
      const o = U.normalize(org);
      if (!o) return '';
      if (/nutanix/.test(o)) return 'nutanix';
      if (partnerNames.some((p) => o === p || o.includes(p))) return 'partner';
      return 'customer';
    };
    const ROLE_RE = /\b(it|dir|director|vp|cio|cto|ciso|cfo|ceo|manager|mgr|admin|engineer|architect|ops|operations|lead|head|analyst|president|owner|sysadmin|infra\w*|security|network|storage|dba|procurement|finance)\b/i;
    const add = (rawName, org, role) => {
      let name = String(rawName || '').trim();
      const pm = name.match(/^(.*?)\s*[(\[]([^)\]]+)[)\]]\s*$/) || name.match(/^(.*?)\s+[-–|]\s+(.+)$/);
      if (pm) { name = pm[1].trim(); if (ROLE_RE.test(pm[2])) role = role || pm[2].trim(); else org = org || pm[2].trim(); }
      if (!name || !isNameLike(name) || /\bteam$/i.test(name) || PRONOUNS.test(name.split(/\s+/)[0])) return;
      const key = U.normalize(name);
      const prev = people.get(key);
      people.set(key, {
        name: prev && prev.name.length > name.length ? prev.name : name,
        organization: org || (prev && prev.organization) || '', role: role || (prev && prev.role) || '',
        side: sideOfOrg(org) || (prev && prev.side) || '',
      });
    };
    doc.attendees.forEach((a) => add(a));
    // "Call with Maria (IT dir) + Tom (plant ops)" style headers
    const head = doc.headLines.join(' ');
    for (const m of head.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s*\(([^)\d]{2,40})\)/g)) add(`${m[1]} (${m[2]})`);
    doc.utterances.forEach((u) => add(u.speaker));
    doc.actionLines.forEach((a) => a.assignee && add(a.assignee));
    return { people, partnerNames, addPerson: add };
  }

  function classifyOwner(name, ctx) {
    const n = U.normalize(name).replace(/\b(side|team|folks|group)\b/g, '').trim();
    if (!n || /^(i|we|us|me|my|our|myself|nutanix se|se)$/.test(n)) return 'me';
    const me = U.normalize(ctx.userName);
    if (me && (n === me || n.split(' ')[0] === me.split(' ')[0])) return 'me';
    const p = ctx.people.get(n) || [...ctx.people.values()].find((x) => U.normalize(x.name).split(' ')[0] === n.split(' ')[0] && n.split(' ').length === 1);
    if (/\b(ae|account exec|account executive|sales ?rep|rep|account manager)\b/.test(n)) return 'account_exec';
    if (p && p.side === 'nutanix') return 'nutanix_other';
    if (p && p.side === 'partner') return 'partner';
    if (/\bnutanix\b/.test(n)) return 'nutanix_other';
    if (/\b(partner|reseller|var|integrator)\b/.test(n) || ctx.partnerNames.some((x) => n === x || n.includes(x))) return 'partner';
    return 'customer';
  }

  // =========================================================================
  // Action items
  // =========================================================================
  function isCommitment(s) {
    if (NOT_ACTION.test(s) || /\?$/.test(s) && !REQUEST_RE.test(s)) return false;
    if (/\b(did|was|were|had|last (week|time|meeting)|previously|already)\b/i.test(s) && !/\b(will|going to|'ll|need to)\b/i.test(s)) return false;
    return FIRST_PERSON_RE.test(s) || LET_ME_RE.test(s) || REQUEST_RE.test(s) || THIRD_RE.test(s) || /\b(action item|next step|to-?do)\b/i.test(s);
  }

  /** Shapes a commitment clause into an imperative task title. */
  function toTaskTitle(s) {
    let t = String(s)
      .replace(DATE_PHRASE_RE, ' ')
      .replace(/^(?:so|ok(?:ay)?|and|then|great|also|yeah|alright|perfect),?\s+/i, '')
      .replace(/^(?:(?:we |i )?(?:need|needs|have|has) to|must|should|todo:?|to-?do:?|follow[- ]up:?(?= )|go ahead and|try to|also|then|just|quickly|definitely|probably|make sure (?:to|that we|we)|work to|be sure to)\s+/i, '')
      .replace(/[\s.!?]+$/, '')
      .replace(/^get you\s+/i, 'send ')
      .replace(/\b(send|get|share|forward|email|provide|give|shoot)\s+(?:you|y'all|you guys|you all|over)\s+(?:over\s+)?/i, '$1 ')
      .replace(/\b(back )?(?:over )?to you( all| guys)?\b/i, '$1to the customer')
      .replace(/\s+(?:and|so|but|because|as well|too|if possible|when (?:you|we) can|for (?:you|them|us))\s*$/i, '')
      .replace(/\s+(?:so that|so we can|because|which will|and then we'll|, and then)\b.*$/i, '')
      .replace(/[\s,;:.!?"')]+$/, '').replace(/^[\s"'(]+/, '')
      .replace(/\s+([,;:])/g, '$1').replace(/[,;:]+$/, '').replace(/\s{2,}/g, ' ').trim();
    t = trimTo(t, 150);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /** Parses one line/sentence into an action item, or null. */
  function parseAction(input, opts, ctx) {
    let s = stripBullet(String(input)).replace(MARKER_RE, '').replace(/^\[[ xX]?\]\s*/, '').trim();
    if (s.length < 5) return null;
    let speaker = opts.speaker || '';
    let ownerName = opts.assignee || '';
    let kind = ownerName ? 'assigned' : '';

    // "Name: do X" (notes) — in an actions list the prefix names the owner.
    let m = s.match(new RegExp(`^(${NAME_RE}(?:\\s+team)?)\\s*[:\\-–]\\s+(.+)$`));
    if (m && !detectHeading(m[1]) && m[1].split(/\s+/).length <= 4 && !PRONOUNS.test(m[1])) {
      if (opts.fromList) { ownerName = m[1]; kind = 'assigned'; } else speaker = speaker || m[1];
      s = m[2];
    }
    // "[Name] do X" / "@Name do X" / "do X (Name)" / "do X - Name"
    if ((m = s.match(/^[\[@]([^\]]{2,40}?)\]?\s+(.+)$/)) && isNameLike(m[1].replace(/^@/, ''))) { ownerName = m[1].replace(/^@/, ''); kind = 'assigned'; s = m[2]; }
    else if ((m = s.match(new RegExp(`^(.+?)\\s*(?:\\((${NAME_RE})\\)|[-–—]\\s*(${NAME_RE}))\\.?$`))) && isNameLike(m[2] || m[3]) && !HAS_DATE_RE.test(m[2] || m[3])) {
      ownerName = m[2] || m[3]; kind = 'assigned'; s = m[1];
    }

    // Narrow long sentences to the clause that holds the commitment.
    if (!opts.fromList) {
      const hits = [FIRST_PERSON_RE, LET_ME_RE, REQUEST_RE, THIRD_RE].map((re) => { const x = s.match(re); return x ? x.index : -1; }).filter((i) => i >= 0);
      if (hits.length) s = s.slice(Math.min(...hits));
    }
    const dueSource = s;

    if ((m = s.match(/^(i|we)(?:'ll| will| can| am going to|'m going to| are going to|'re going to| need to| should| have to| owe| plan to| want to| would like to| are to)\s+(.+)$/i))) {
      kind = 'self'; s = m[2]; if (m[1].toLowerCase() === 'we' && !speaker) ownerName = ownerName || '';
    } else if ((m = s.match(/^let me\s+(.+)$/i))) { kind = 'self'; s = m[1]; }
    else if ((m = s.match(/^(?:can|could|would) you(?: please| guys| all| folks)?\s+(.+?)\??$/i)) || (m = s.match(/^please\s+(.+)$/i))) { kind = 'request'; s = m[1]; }
    else if ((m = s.match(new RegExp(`^(${NAME_RE}(?:\\s+(?:and|&)\\s+${NAME_RE})*(?:\\s+team)?)(?:\\s*\\(([^)]+)\\))?\\s+(?:will|to|shall|should|needs? to|has to|have to|is going to|are going to|agreed to|committed to|volunteered to|offered to|plans? to|is to|are to|owes?)\\s+(.+)$`))) && !PRONOUNS.test(m[1].split(/\s+/)[0])) {
      ownerName = m[1]; kind = 'assigned'; s = m[3];
      if (m[2]) ctx.people.set(U.normalize(m[1]), { name: m[1], organization: m[2], side: /nutanix/i.test(m[2]) ? 'nutanix' : ctx.partnerNames.some((p) => U.normalize(m[2]).includes(p)) ? 'partner' : 'customer' });
    } else if (!opts.fromList && !opts.imperative) return null;

    // Owner
    let owner;
    if (kind === 'self') { owner = speaker ? classifyOwner(speaker, ctx) : 'me'; ownerName = speaker || ownerName; }
    else if (kind === 'request') {
      const speakerSide = speaker ? classifyOwner(speaker, ctx) : 'me';
      owner = ['me', 'account_exec', 'nutanix_other'].includes(speakerSide) ? 'customer' : 'me';
      ownerName = '';
    } else owner = ownerName ? classifyOwner(ownerName, ctx) : 'me';
    if (owner === 'customer' && !ctx.userName && ownerName && /\b(bom|sizing|size|quote|demo|design|architecture|collector|deck|proposal|poc plan|success criteria)\b/i.test(s)) owner = 'me';

    const title = toTaskTitle(s);
    if (words(title).length < 2 || title.length < 8) return null;

    const lower = dueSource.toLowerCase();
    let priority = 'medium';
    if (/\b(asap|urgent|critical|blocker|blocking|immediately|right away|today|tonight|tomorrow|eod|cob|priority|time[- ]sensitive|before (the )?(poc|call|meeting|renewal))\b/.test(lower)) priority = 'high';
    else if (/\b(nice to have|eventually|when (you|we) (can|get a chance)|no rush|at some point|optional|longer[- ]term|down the road)\b/.test(lower)) priority = 'low';
    let dueDate = parseDueDate(dueSource, ctx.meetingDate);
    if (!dueDate && /\bbefore (the )?(next|follow[- ]up) (meeting|call|session)\b/.test(lower) && ctx.nextMeeting) dueDate = U.addBusinessDays(U.addDays(ctx.nextMeeting, -3), 1);
    const explicitDate = !!dueDate;
    if (!dueDate) dueDate = U.addBusinessDays(ctx.meetingDate, priority === 'high' ? 1 : priority === 'low' ? 10 : owner === 'customer' ? 5 : 3);
    if (explicitDate && U.daysBetween(ctx.meetingDate, dueDate) <= 2 && priority === 'medium') priority = 'high';

    return {
      title, details: opts.fromList || title.length > 90 ? '' : '', owner, ownerName: kind === 'request' ? '' : ownerName,
      dueDate, priority, _explicitDate: explicitDate, _fromList: !!opts.fromList, _kind: kind, _speaker: speaker,
    };
  }

  function extractActions(doc, sentences, ctx) {
    const items = [];
    for (const a of doc.actionLines) {
      const am = a.assignee.match(/^(.*?)\s*\(([^)]+)\)$/);
      if (am) { a.assignee = am[1]; ctx.addPerson(a.assignee, am[2]); }
      for (const part of String(a.text).split(/;\s+(?=[A-Z])/)) {
        const it = parseAction(part, { assignee: a.assignee, fromList: true }, ctx);
        if (it) items.push(it);
      }
    }
    // Commitments made in the discussion itself (all formats).
    const listItems = items.slice();
    const speakers = [...new Set(doc.utterances.map((u) => u.speaker))];
    let fromBody = 0;
    let lastRequest = null; // { item, speaker, at }
    sentences.forEach((sent, at) => {
      if (fromBody >= 20) return;
      const imperative = doc.format === 'notes' && IMPERATIVE_RE.test(sent.text) && words(sent.text).length <= 25;
      if (!imperative && !isCommitment(sent.text)) return;
      // "I'll do X, and I'll send Y" -> two tasks
      const sentenceDue = parseDueDate(sent.text, ctx.meetingDate);
      const clauses = sent.text.split(/,?\s+(?:and\s+)?(?=(?:i|we)(?:'ll| will)\s)/i).filter(Boolean);
      for (const clause of clauses) {
        const it = parseAction(clause, { speaker: sent.speaker, imperative }, ctx);
        if (!it) continue;
        if (!it._explicitDate && sentenceDue && clauses.length > 1) { it.dueDate = sentenceDue; it._explicitDate = true; }
        // In a two-person transcript the addressee of a request is the other speaker.
        if (it._kind === 'request' && speakers.length === 2 && sent.speaker) {
          it.ownerName = speakers.find((x) => x !== sent.speaker);
          it.owner = classifyOwner(it.ownerName, ctx);
          lastRequest = { item: it, speaker: sent.speaker, at };
        }
        // "Sure, I can get that to you tomorrow" -> assign the earlier request instead of creating a vague task.
        if (it._kind === 'self' && lastRequest && sent.speaker && sent.speaker !== lastRequest.speaker && at - lastRequest.at <= 4 &&
            /\b(that|it|this|those|them|these)\b/i.test(it.title) && words(it.title).length <= 8) {
          const req = lastRequest.item;
          req.owner = classifyOwner(sent.speaker, ctx); req.ownerName = sent.speaker;
          if (it._explicitDate) { req.dueDate = it.dueDate; req._explicitDate = true; req.priority = it.priority; }
          lastRequest = null;
          continue;
        }
        // Zoom summaries: prose that restates a listed next step is not a new task.
        if (listItems.some((x) => similarity(x.title, it.title) >= 0.34)) continue;
        items.push(it); fromBody++;
      }
    });
    // Merge duplicates: prefer items from an explicit list, with a date, with an owner name.
    const rank = (x) => (x._fromList ? 4 : 0) + (x._explicitDate ? 2 : 0) + (x.ownerName ? 1 : 0);
    const sorted = [...items].sort((a, b) => rank(b) - rank(a));
    const merged = uniqueBy(sorted, (x) => x.title, 0.6);

    // Standard SE follow-ups.
    const has = (re) => merged.some((x) => re.test(x.title));
    const what = ctx.followUpWhat ? ctx.followUpWhat : 'follow-up meeting';
    if (ctx.nextMeeting && !has(/\b(schedule|invite|book|set ?up)\b.*\b(meeting|call|session|follow[- ]?up|workshop)\b/i)) {
      merged.push({ title: `Send calendar invite for ${what} (${U.formatDate(ctx.nextMeeting, { weekday: 'short', month: 'short', day: 'numeric' })})`, details: '', owner: 'me', ownerName: ctx.userName || '', dueDate: U.addBusinessDays(ctx.meetingDate, 1), priority: 'medium' });
    } else if (ctx.followUpMentioned && !has(/\b(schedule|invite|book|set ?up)\b.*\b(meeting|call|session|follow[- ]?up|workshop)\b/i)) {
      merged.push({ title: 'Schedule ' + what, details: '', owner: 'me', ownerName: ctx.userName || '', dueDate: U.addBusinessDays(ctx.meetingDate, 2), priority: 'medium' });
    }
    if (!has(/\b(recap|summary|notes|follow[- ]?up email|minutes)\b/i)) {
      merged.unshift({ title: 'Send meeting recap and next steps to attendees', details: '', owner: 'me', ownerName: ctx.userName || '', dueDate: U.addBusinessDays(ctx.meetingDate, 1), priority: 'high' });
    }
    const ownerOrder = { me: 0, account_exec: 1, nutanix_other: 2, partner: 3, customer: 4 };
    return merged
      .map(({ _explicitDate, _fromList, _kind, _speaker, ...x }) => x)
      .sort((a, b) => (ownerOrder[a.owner] - ownerOrder[b.owner]) || a.dueDate.localeCompare(b.dueDate))
      .slice(0, 25);
  }

  // =========================================================================
  // Classification of discussion content
  // =========================================================================
  const CATEGORY_RULES = [
    ['decisions', /^(?!.*\b(not|n't|never|pending|until|unless|if)\b).*\b(agreed|decided|decision (was|is)|approved|signed off|sign-off (was )?(given|received)|(will|to) move forward|moving forward with|chose|selected|go(ing)? with|green ?light|confirmed that|committed to)\b/i],
    ['risks', /\b(risk|concern(ed|s)?|blocker|worried|hesitan\w*|pushback|objection|skeptic\w*|not (yet )?approved|hasn't been approved|unclear|unknown|delay(ed)?|push(ed)? (out|back)|evaluating (other|alternatives)|also (looking at|considering|talking to)|looking at [\w -]{2,30}\b(too|as well)|shopping|competing|open question|tbd|pending|at risk|freeze|budget (is )?(tight|cut|not)|no budget|politic\w*)\b/i],
    ['pain', /\b(pain|challeng\w*|struggl\w*|frustrat\w*|problem|issue|headache|too (slow|expensive|complex|costly)|cost(s)? (increase|went up|are up|going up)|price increase|(\d+(\.\d+)?x|tripled|doubled|quadrupled)|renewal|end of (life|support)|\beol\b|licensing change|broadcom|manual(ly)?|downtime|outage|complexit\w*|can't scale|capacity (issues|constraints)|siloed|sprawl|lack of|limited|painful|legacy|no (secondary|dr|backup|redundan\w*)|flagged|audit (finding|issue)|gap|single point of failure|exposed|out of warranty|aging|old)\b/i],
    ['requirements', /\b(require\w*|must(?! have been)|need(s)? to (support|have|be able|be off|be out|run|handle|meet|integrate|migrate|move)|before (the )?(contract|renewal|license) (ends|expires|is up)|deadline|success criteria|\brpo\b|\brto\b|\bsla\b|complian\w*|hipaa|pci|soc ?2|fedramp|should support|looking for|goal is|objective|has to (support|run|be)|integrat\w* with|high availability|\bha\b|wants? (central|centrali[sz]ed|single|one|a single|to (have|consolidate|simplify|standardi[sz]e|reduce|modernize|replace|get off|move))|performance (target|requirement)|latency)\b/i],
    ['environment', /\b(currently|today (they|we|it)|running (on|about|roughly|approximately|\d)|existing|current (environment|setup|infrastructure|platform|state)|vsphere|esxi|vcenter|hyper-v|dell|hpe|cisco|lenovo|ucs|\bsan\b|netapp|pure|nimble|vxrail|\d+\s*(hosts|vms|nodes|clusters|sites|tb|pb|cores|users|desktops|servers|racks|data ?cent(er|re)s?))\b/i],
  ];

  const FILLER_SENTENCE = /\b(hear (you|me|us)|see (you|it|my screen|the screen)|how are you|good (morning|afternoon)|thanks (everyone|all|for (joining|your time|having))|can you hear|see my screen|you're on mute|weather|weekend|vacation|hello|hi (all|everyone|team)|nice to meet|sounds good|makes sense|no problem|talk soon|have a good|bye|awesome|perfect|cool)\b/i;

  function scoreSentence(s, idx, total, ctx) {
    const w = words(s).length;
    let score = 0;
    for (const t of TOPICS) if (t.re.test(s)) score += 1.2;
    if (/\d/.test(s)) score += 0.8;
    if (/\$|\b\d+%|\b\d+\s*(vms|tb|pb|nodes|hosts|sites|users|cores)\b/i.test(s)) score += 1;
    for (const [, re] of CATEGORY_RULES) if (re.test(s)) score += 0.8;
    if (ctx.account && new RegExp('\\b' + U.normalize(ctx.account.name).split(' ')[0] + '\\b', 'i').test(s)) score += 0.5;
    if (w < 6) score -= 2.5; else if (w > 45) score -= 1; else if (w >= 10 && w <= 30) score += 0.5;
    if (FILLER_SENTENCE.test(s)) score -= 3;
    if (/\?$/.test(s)) score -= 0.8;
    score += (1 - idx / Math.max(total, 1)) * 0.6;
    return score;
  }

  function detectTopics(text) {
    return TOPICS.map((t) => ({ ...t, hits: (String(text).match(new RegExp(t.re.source, 'gi')) || []).length }))
      .filter((t) => t.hits > 0).sort((a, b) => b.hits - a.hits);
  }

  const joinList = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);

  // =========================================================================
  // Matching & stage
  // =========================================================================
  const GENERIC_WORDS = new Set(['the', 'inc', 'corp', 'corporation', 'company', 'co', 'llc', 'ltd', 'group', 'health', 'healthcare', 'university', 'college',
    'bank', 'systems', 'solutions', 'services', 'technologies', 'technology', 'county', 'city', 'state', 'of', 'and', 'manufacturing', 'logistics', 'hospital', 'global', 'international']);

  function matchAccount(notesNorm, ctx, doc) {
    if (ctx.accountId) return ctx.accountId;
    let best = { id: '', score: 0 };
    for (const a of ctx.accounts) {
      const full = U.normalize(a.name);
      if (!full) continue;
      let score = (notesNorm.split(' ' + full + ' ').length - 1) * 3;
      const distinct = full.split(' ').filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
      for (const w of distinct) score += Math.min(4, 2 * (notesNorm.split(' ' + w + ' ').length - 1));
      if (doc.title && U.normalize(doc.title).includes(full)) score += 5;
      if (score > best.score) best = { id: a.id, score };
    }
    return best.score >= 2 ? best.id : '';
  }

  function guessAccountName(doc, text, ctx) {
    const reject = (s) => !s || /nutanix/i.test(s) || ctx.partnerNames.some((p) => U.normalize(s) === p) || (ctx.userName && U.normalize(s).includes(U.normalize(ctx.userName)));
    if (doc.title) {
      const parts = doc.title.split(/\s*(?:\/|\||<>|\bx\b|&|\+|\bwith\b|\band\b|[-–—:])\s*/i).map((s) => s.trim()).filter(Boolean);
      const cand = parts.find((p) => !reject(p) && !/\b(meeting|sync|call|review|poc|demo|kickoff|kick-off|workshop|discussion|update|weekly)\b/i.test(p) && /^[A-Z]/.test(p));
      if (cand) return cand;
    }
    const orgCounts = {};
    for (const p of ctx.people.values()) if (p.organization && p.side === 'customer') orgCounts[p.organization] = (orgCounts[p.organization] || 0) + 1;
    const org = Object.entries(orgCounts).sort((a, b) => b[1] - a[1])[0];
    if (org) return org[0];
    const m = text.match(/\b((?:[A-Z][A-Za-z&]+ ){0,3}[A-Z][A-Za-z&]+ (?:Inc|Corp|Corporation|LLC|Health|Healthcare|University|College|Bank|Group|Systems|Logistics|Manufacturing|Hospital|Medical Center|County|Schools|School District|Insurance|Energy|Foods|Airlines))\b/);
    return m && !reject(m[1]) ? m[1] : '';
  }

  function matchDeal(notesNorm, accountId, ctx) {
    if (ctx.dealId) return ctx.dealId;
    if (!accountId) return '';
    const open = ctx.deals.filter((d) => d.accountId === accountId && (STAGES.find((s) => s.id === d.stage) || {}).open);
    const scored = open.map((d) => {
      const ws = [...new Set(U.normalize(d.name).split(' ').filter((w) => w.length > 2 && !STOP.has(w)))];
      return { d, score: ws.filter((w) => notesNorm.includes(' ' + w + ' ')).length };
    }).sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score >= 2 && (!scored[1] || scored[1].score < scored[0].score)) return scored[0].d.id;
    return open.length === 1 ? open[0].id : '';
  }

  const STAGE_SIGNALS = [
    ['closed_won', /\b(po (was )?(received|issued|signed)|purchase order (was )?(received|issued|signed)|signed the (order|contract|quote|agreement)|closed[- ]won|booked the deal|deal (is )?(closed|booked)|we won)\b/i],
    ['closed_lost', /\b((went|going) with|chose|selected|decided on) (vmware|broadcom|dell|hpe|microsoft|azure|proxmox|red hat|openshift|another vendor|a competitor|the competitor)\b|\b(closed[- ]lost|decided not to (proceed|move forward)|no longer (moving forward|pursuing|interested)|project (was )?(cancel+ed|shelved|killed)|lost (it |the deal )?to)\b/i],
    ['tech_win', /\b(technical win|tech win|approved the (design|config|configuration|architecture|bom|solution)|signed off on the (design|config|configuration|bom|architecture|solution)|poc (was |is )?(successful|a success|passed|complete[d]?)|passed (the|all) (poc|success criteria)|met (all )?(of )?(the )?success criteria|validated the (solution|design)|confirmed (nutanix|the solution|it) (meets|can meet|will meet|solves))\b/i],
    ['tech_diff', /\b(poc|proof of concept|pilot|success criteria|bom|bill of materials|test ?drive|design session|architecture (workshop|session|review)|configuration (review|session|workshop))\b/i],
    ['develop', /\b(stakeholders?|decision makers?|economic buyer|champion|timeline|budget (cycle|approved|allocated|process)|procurement|requirements (gathering|workshop|document|session)|rfp|rfi|rfq|evaluation criteria|buying process)\b/i],
    ['discovery', /\b(pain points?|metrics|business case|why change|current (costs?|spend)|tco|roi|compelling event|renewal date|discovery (call|session|meeting))\b/i],
  ];
  const HYPOTHETICAL = /\b(might|maybe|possibly|could potentially|eventually|down the road|at some point|not yet|if we|if they|would (like|consider)|considering|thinking about|future)\b/i;

  function recommendStage(sentences, deal, isNewDeal) {
    const current = deal ? deal.stage : 'identified';
    const curOrder = (STAGES.find((s) => s.id === current) || STAGES[0]).order;
    for (const [stage, re] of STAGE_SIGNALS) {
      const hit = sentences.find((s) => re.test(s.text) && !(HYPOTHETICAL.test(s.text) && !/^closed/.test(stage)));
      if (!hit) continue;
      const st = STAGES.find((s) => s.id === stage);
      if (stage === current) return { stage: 'no_change', rationale: `Notes are consistent with the current stage (${st.name}).` };
      if (st.order > curOrder || stage === 'closed_lost' || (!deal && !isNewDeal)) {
        const evidence = trimTo(hit.text.replace(/^\s*[\w .'-]{1,40}:\s+/, ''), 160);
        return { stage, rationale: `"${evidence}" — matches ${st.name}: ${st.definition} Verify before moving.` };
      }
      return { stage: 'no_change', rationale: `Latest signals point to ${st.name}, which is behind the current stage — no move suggested.` };
    }
    return { stage: 'no_change', rationale: 'No clear stage exit-criteria signals found in the notes.' };
  }

  // =========================================================================
  // Main
  // =========================================================================
  /**
   * @param {string} rawNotes
   * @param {{accounts, deals, userName, meetingDate, accountId, dealId}} ctxIn
   */
  function analyzeNotes(rawNotes, ctxIn) {
    const text = cleanTranscript(rawNotes);
    const doc = segment(text);
    let meetingDate = ctxIn.meetingDate || U.todayISO();
    if (!ctxIn.meetingDateLocked && doc.titleDate) {
      const d = new Date(doc.titleDate);
      if (!isNaN(d)) meetingDate = U.toLocalISODate(d);
    }
    const ctx = { ...ctxIn, meetingDate, people: new Map(), partnerNames: [] };
    const notesNorm = ' ' + U.normalize(text) + ' ';

    // Account first (owner classification uses its partner).
    const accountId = matchAccount(notesNorm, ctx, doc);
    ctx.account = ctx.accounts.find((a) => a.id === accountId) || null;
    Object.assign(ctx, buildPeople(doc, ctx));

    // Sentences (with speaker) outside the explicit action list.
    const sentences = [];
    if (doc.format === 'transcript') {
      for (const u of doc.utterances) for (const s of splitSentences(deFiller(u.text))) sentences.push({ text: s, speaker: u.speaker });
    }
    for (const [sec, lines] of Object.entries(doc.sections)) {
      if (sec === 'attendees') continue;
      for (const l of lines) for (const s of splitSentences(l)) sentences.push({ text: s, speaker: '', section: sec });
    }
    for (const t of doc.topics) if (!doc.sections.summary && !doc.sections.body) for (const l of t.lines) for (const s of splitSentences(l)) sentences.push({ text: s, speaker: '', section: 'summary' });

    // Next meeting
    const nm = sentences.find((s) => /\b(next (meeting|call|sync|session|touchpoint|check-?in)|follow[- ]up (meeting|call|session)|reconvene|meet again|regroup|workshop)\b/i.test(s.text));
    ctx.followUpMentioned = !!nm;
    ctx.nextMeeting = nm ? parseDueDate(nm.text, meetingDate) : '';
    if (nm) {
      const w = nm.text.match(/\b(workshop|demo|design session|deep[- ]dive|whiteboard(?:ing)? session|architecture (?:review|session)|follow[- ]up (?:call|meeting|session))\b(?:\s+(?:on|about|for|covering)\s+((?:the\s+)?[\w/&-]+(?:\s+[\w/&-]+){0,4}))?/i);
      if (w) ctx.followUpWhat = (w[1] + (w[2] ? ' on ' + w[2].replace(DATE_PHRASE_RE, '').trim() : '')).toLowerCase().replace(/\bpoc\b/, 'POC');
    }

    const actionItems = extractActions(doc, sentences, ctx);
    // People named as owners are meeting participants too.
    const sideOf = { me: 'nutanix', account_exec: 'nutanix', nutanix_other: 'nutanix', partner: 'partner', customer: 'customer' };
    for (const a of actionItems) {
      const n = U.normalize(a.ownerName);
      if (!n || !isNameLike(a.ownerName) || /\bteam\b/.test(n)) continue;
      const existing = ctx.people.get(n) || [...ctx.people.values()].find((p) => U.normalize(p.name).startsWith(n + ' ') || n.startsWith(U.normalize(p.name) + ' '));
      if (!existing) ctx.people.set(n, { name: a.ownerName, organization: '', role: '', side: sideOf[a.owner] || '' });
    }
    if (ctx.userName) for (const [k, p] of ctx.people) if (classifyOwner(p.name, ctx) === 'me' && U.normalize(p.name) !== U.normalize(ctx.userName) && U.normalize(ctx.userName).startsWith(k)) ctx.people.delete(k);

    // Categorize content sentences.
    const actionTexts = actionItems.map((a) => a.title);
    const content = sentences.filter((s) => !isCommitment(s.text) && !(doc.format === 'notes' && IMPERATIVE_RE.test(s.text)) &&
      words(s.text).length >= 4 && !FILLER_SENTENCE.test(s.text) && !/\b(call|meeting|sync|mtg|chat) (w\/|with)\b/i.test(s.text) && !(/\?$/.test(s.text) && doc.format === 'transcript'));
    const cat = { pain: [], requirements: [], environment: [], risks: [], decisions: [] };
    const tidy = (t) => { const x = t.replace(/^[-•*]\s*/, '').replace(/^(risks?|pain( points?)?|reqs?|requirements?|decisions?|env(ironment)?|notes?|fyi|competition)\s*:\s*/i, '').trim(); return x.charAt(0).toUpperCase() + x.slice(1); };
    const clean = (s) => trimTo(tidy(s.text), 240) + (s.speaker && doc.format === 'transcript' ? ` (${s.speaker})` : '');
    for (const sec of Object.keys(cat)) for (const l of doc.sections[sec] || []) cat[sec].push(tidy(l));
    for (const l of doc.sections.competition || []) cat.risks.push('Competition: ' + l);
    for (const s of content) {
      if (s.section && s.section in cat) continue;
      const hits = CATEGORY_RULES.filter(([, re]) => re.test(s.text)).map(([k]) => k);
      // A sentence lands in at most two buckets; "environment" only when nothing more specific applies.
      const chosen = hits.filter((k) => k !== 'environment').slice(0, 2);
      if (!chosen.length && hits.includes('environment')) chosen.push('environment');
      if (/^risk\s*:/i.test(s.text)) chosen.splice(0, chosen.length, 'risks');
      for (const k of chosen) cat[k].push(clean(s));
    }
    for (const k of Object.keys(cat)) cat[k] = uniqueBy(cat[k].filter((x) => !actionTexts.some((t) => similarity(t, x) > 0.8)), (x) => x, 0.7).slice(0, 8);

    const competitors = COMPETITORS.filter((c) => new RegExp('\\b' + c.replace(/\s+/g, '\\s+') + '\\b', 'i').test(text));

    // Summary + discussion points
    const topics = detectTopics(text);
    const topicLabels = topics.slice(0, 4).map((t) => t.label);
    const customerPeople = [...ctx.people.values()].filter((p) => classifyOwner(p.name, ctx) !== 'me').map((p) => p.name);
    let summary = '';
    let discussionPoints = [];
    if (doc.sections.recap && doc.sections.recap.length) {
      summary = splitSentences(doc.sections.recap.join(' ')).slice(0, 7).join(' ');
    }
    if (doc.topics.length) {
      discussionPoints = doc.topics.map((t) => {
        const first = splitSentences(t.lines.join(' ')).slice(0, 2).join(' ');
        return first ? `${t.title} — ${trimTo(first, 280)}` : t.title;
      });
    }
    const ranked = content
      .map((s, i) => ({ ...s, i, score: scoreSentence(s.text, i, content.length, ctx) }))
      .filter((s) => s.section !== 'recap');
    const top = uniqueBy([...ranked].sort((a, b) => b.score - a.score).filter((s) => s.score > 0.5), (s) => s.text, 0.6);
    if (!summary) {
      const acctName = ctx.account ? ctx.account.name : guessAccountName(doc, text, ctx);
      const who = customerPeople.length ? ` with ${joinList(customerPeople.slice(0, 4))}` : '';
      const intro = topicLabels.length
        ? `${acctName ? acctName + ' meeting' : 'Meeting'}${who} covering ${joinList(topicLabels)}.`
        : `${acctName ? acctName + ' meeting' : 'Meeting'}${who}.`;
      const key = top.slice(0, doc.format === 'transcript' ? 4 : 3).sort((a, b) => a.i - b.i).map((s) => {
        const t = tidy(s.text).replace(/[.!?]?$/, (e) => e || '.');
        return s.speaker && doc.format === 'transcript' ? t.replace(/([.!?])$/, ` (${s.speaker})$1`) : t;
      });
      summary = [intro, ...key].join(' ');
    }
    if (!discussionPoints.length) {
      discussionPoints = top.filter((s) => similarity(s.text, summary) < 0.9).slice(0, 8).sort((a, b) => a.i - b.i).map(clean);
    }

    // Attendees
    const attendees = [...ctx.people.values()].map((p) => ({ name: p.name, organization: p.organization, role: p.role || '' }));

    // Account / deal / stage
    const suggestedAccountName = ctx.account ? ctx.account.name : guessAccountName(doc, text, ctx);
    const dealId = matchDeal(notesNorm, accountId, ctx);
    const deal = ctx.deals.find((d) => d.id === dealId) || null;
    const openDeals = accountId ? ctx.deals.filter((d) => d.accountId === accountId && (STAGES.find((s) => s.id === d.stage) || {}).open) : [];
    const topicDeal = topics.find((t) => t.deal);
    const suggestedDealName = !deal && !openDeals.length ? (topicDeal ? topicDeal.deal : 'New opportunity') : '';
    const reco = recommendStage(sentences, deal, !!suggestedDealName);

    // Title
    let title;
    if (doc.title) title = doc.title;
    else {
      const t0 = doc.topics[0] ? doc.topics[0].title : topicLabels[0] ? topicLabels[0].replace(/^\w/, (c) => c.toUpperCase()) : 'Meeting';
      title = suggestedAccountName ? `${suggestedAccountName} – ${t0}` : `${t0} discussion`;
    }

    const ADMIN = /\b(recap|calendar invite)\b|^schedule follow-up/i;
    const mine = actionItems.filter((a) => a.owner === 'me' && !ADMIN.test(a.title));
    const result = {
      title: trimTo(title, 120),
      meetingDate,
      matchedAccountId: accountId,
      suggestedAccountName,
      matchedDealId: dealId,
      suggestedDealName,
      attendees,
      summary,
      discussionPoints,
      painPoints: cat.pain,
      requirements: cat.requirements,
      environment: cat.environment,
      competitors,
      risks: cat.risks,
      decisions: cat.decisions,
      actionItems,
      suggestedStage: reco.stage,
      stageRationale: reco.rationale,
      dealNextStep: (mine[0] || actionItems.find((a) => !ADMIN.test(a.title)) || actionItems[0] || {}).title || '',
      followUpEmail: '',
      format: doc.format,
    };
    result.followUpEmail = buildEmail(result, ctx, customerPeople);
    return result;
  }

  function buildEmail(r, ctx, customerPeople) {
    const firstNames = [...new Set(customerPeople.filter((n) => classifyOwner(n, ctx) === 'customer').map((n) => n.split(' ')[0]))];
    const greeting = firstNames.length ? `Hi ${joinList(firstNames.slice(0, 4))},` : 'Hi all,';
    const when = r.meetingDate === U.todayISO() ? 'today' : 'on ' + U.formatDate(r.meetingDate, { weekday: 'long', month: 'short', day: 'numeric' });
    const takeaways = [...r.decisions, ...r.requirements].map((x) => x.replace(/\s\([^)]*\)$/, ''))
      .filter((x) => similarity(x, r.summary) < 0.8).slice(0, 4);
    const groups = [
      ['Nutanix', ['me', 'account_exec', 'nutanix_other']],
      [r.suggestedAccountName || 'Your team', ['customer']],
      ['Partner', ['partner']],
    ];
    const lines = [greeting, '', `Thank you for your time ${when}. Here's a quick recap of what we covered:`, '', r.summary];
    if (takeaways.length) lines.push('', 'Key takeaways:', ...takeaways.map((t) => '• ' + t));
    const steps = r.actionItems.filter((a) => !/^send meeting recap/i.test(a.title));
    if (steps.length) {
      lines.push('', 'Next steps:');
      for (const [label, owners] of groups) {
        const items = steps.filter((a) => owners.includes(a.owner));
        if (!items.length) continue;
        lines.push(label + ':', ...items.map((a) => `• ${a.title}${a.ownerName && a.owner !== 'me' ? ' (' + a.ownerName + ')' : ''} – by ${U.formatDate(a.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })}`));
      }
    }
    lines.push('', 'Please let me know if I missed anything or if any of the dates need to change.', '', 'Best regards,', ctx.userName || '');
    return lines.join('\n').trim();
  }

  /** Coerces a result to the contract (guards manual/imported/partial data). */
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
      format: ['summary', 'transcript', 'notes', 'manual'].includes(r.format) ? r.format : 'manual',
    };
  }

  /** Public entry point used by the UI. */
  function processNotes(notes, ctx) {
    if (!String(notes || '').trim()) throw new Error('Paste or drop your meeting notes first');
    return sanitize(analyzeNotes(notes, ctx), ctx);
  }

  NX.analyzer = { processNotes, analyzeNotes, sanitize, cleanTranscript, parseDueDate, deFiller, splitSentences, toTaskTitle };
})(globalThis.NX = globalThis.NX || {});
