/* MEDDPICC for the deal tracker: the rubric, the strength score and the meeting-notes extractor.
 *
 * Pure data + pure functions, no DOM. The page loads this file with <script src="meddpicc.js"> and reads
 * window.MEDDPICC; the unit tests load it into a Node vm context and read globalThis.MEDDPICC.
 *
 * Edit the rubric here (RUBRIC). Criterion ids are stored on saved bullets, so rename a criterion's text
 * freely but keep its id.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ rubric */
  // Each criterion: id (stored on bullets), text (shown in the hover and dropdown),
  // next (short next-step text shown on the tile while it's missing), required.
  const RUBRIC = [
    { id: 'metrics', letter: 'M', name: 'Metrics', meaning: 'The measurable value the customer expects, in their own numbers.', criteria: [
      { id: 'customerOwned', required: true, text: "A metric that is the customer's own, not a Nutanix figure", next: 'Get a number the customer owns' },
      { id: 'businessOutcome', required: true, text: 'Tied to a business outcome (cost, revenue or risk)', next: 'Tie it to a business outcome' },
      { id: 'baselineTarget', text: 'Baseline today and a target', next: "Get today's baseline and target" },
      { id: 'technicalMeasure', text: 'Technical success measure agreed', next: 'Agree the technical success measure' },
      { id: 'ebAgreed', text: 'Agreed with the economic buyer', next: 'Get the EB to sign up to the metrics' },
      { id: 'proofPoint', text: 'A matching proof point or reference chosen', next: 'Pick a matching reference' },
    ] },
    { id: 'economicBuyer', letter: 'E', name: 'Economic Buyer', meaning: 'The person with the authority and discretionary budget to say the final yes, or no.', criteria: [
      { id: 'named', required: true, text: 'Named', next: 'Find out who signs' },
      // Special rule (see scoreLetter): a "Confirmed by 2+ people" bullet, or two met bullets naming different people.
      { id: 'confirmed2', required: true, text: 'Confirmed by two or more people', next: 'Confirm the EB with a second person', rule: 'twoPeople', alsoFrom: ['named'] },
      { id: 'priorities', text: 'Strategic priorities known', next: "Learn the EB's priorities" },
      { id: 'howMuch', text: 'How much / how soon / how sure answered', next: 'Answer how much, how soon, how sure' },
      { id: 'funding', text: 'Funding confirmed', next: 'Confirm the budget exists' },
      { id: 'access', text: 'Met, or an access plan agreed', next: 'Get a meeting or an access plan' },
    ] },
    { id: 'decisionCriteria', letter: 'D', name: 'Decision Criteria', meaning: 'The requirements the customer will use to compare options.', criteria: [
      { id: 'captured', required: true, text: 'Criteria captured (business, technical, financial and partner)', next: 'Get their evaluation criteria' },
      { id: 'differentiator', required: true, text: 'Includes a Nutanix differentiator', next: 'Plant a Nutanix differentiator' },
      { id: 'ranked', text: 'Ranked or weighted', next: 'Get the criteria ranked' },
      { id: 'measurable', text: 'Success criteria measurable', next: 'Make success measurable' },
      { id: 'agreed', text: 'Agreed by key stakeholders', next: 'Confirm who agreed the criteria' },
    ] },
    { id: 'decisionProcess', letter: 'D', name: 'Decision Process', meaning: 'How they will evaluate, select and approve.', criteria: [
      { id: 'validation', required: true, text: 'Validation steps known (POC, references, bake-off)', next: "Map how they'll validate" },
      { id: 'approval', required: true, text: 'Approval steps known', next: 'Map the approval steps' },
      { id: 'timeline', text: 'Timeline with dates and the reason behind them', next: 'Get dates and why they matter' },
      { id: 'stakeholders', text: 'Stakeholders mapped, with what each cares about', next: "Map who's involved" },
      { id: 'askedOthers', text: 'Asked about stakeholders not yet met', next: 'Ask who else has a say' },
      { id: 'tdm', text: 'Technical decision maker identified', next: 'Find the technical decision maker' },
    ] },
    { id: 'paperProcess', letter: 'P', name: 'Paper Process', meaning: 'Everything from a verbal yes to a purchase order.', criteria: [
      { id: 'procurement', required: true, text: 'Procurement, legal and security steps known', next: 'Map procurement, legal and security' },
      { id: 'reverseTimeline', required: true, text: 'Reverse timeline built from go-live back to PO', next: 'Build a reverse timeline' },
      { id: 'duration', text: 'Verbal-to-PO duration known', next: 'Find out how long paperwork takes' },
      { id: 'route', text: 'Route to market agreed (partner, distributor or OEM)', next: 'Confirm the partner and route' },
      { id: 'budgetDeadlines', text: 'Fiscal-year or budget deadlines known', next: 'Find the budget deadlines' },
    ] },
    { id: 'identifiedPain', letter: 'I', name: 'Identified Pain', meaning: 'The problem that compels them to act, within a timeframe.', criteria: [
      { id: 'businessPain', required: true, text: 'Business pain (cost, revenue or risk) confirmed by the customer', next: 'Ladder it up to business pain' },
      { id: 'quantified', required: true, text: 'Pain quantified', next: 'Put a number on the pain' },
      { id: 'technicalPain', text: 'Technical pain identified', next: 'Find the technical pain' },
      { id: 'owner', text: 'Owner of the pain known', next: 'Find who owns the pain' },
      { id: 'compellingEvent', text: 'Compelling event with a date', next: 'Find the compelling event' },
      { id: 'statusQuo', text: 'Impact of doing nothing understood', next: 'Cost out the status quo' },
    ] },
    { id: 'champion', letter: 'C', name: 'Champion', meaning: "Someone with power and influence who sells for us when we're not in the room.", criteria: [
      { id: 'identified', required: true, text: 'Identified, with power and influence', next: 'Find someone with influence' },
      { id: 'tested', required: true, text: 'Passed a test (an EB introduction, walked us through their internal pitch, or shared how the decision is really made)', next: 'Test your champion' },
      { id: 'personalWin', text: 'Their personal win is known', next: 'Learn their personal win' },
      { id: 'techChampion', text: 'Technical champion identified', next: 'Build a technical champion' },
      { id: 'endorsed', text: 'Sizing or solution endorsed by the champion', next: 'Get the sizing endorsed' },
      { id: 'second', text: 'More than one champion', next: 'Develop a second champion' },
    ] },
    { id: 'competition', letter: 'C', name: 'Competition', meaning: 'Every alternative, including doing nothing.', criteria: [
      { id: 'alternatives', required: true, text: 'Alternatives mapped (other vendors, status quo, in-house or public cloud)', next: 'Map every alternative' },
      { id: 'strategy', required: true, text: 'Competitive strategy chosen (head-on, change the criteria, win a part first, or slow down)', next: 'Pick a competitive strategy' },
      { id: 'statusQuoCost', text: 'Cost of the status quo understood', next: 'Cost out doing nothing' },
      { id: 'backers', text: 'Who backs each alternative is known', next: 'Find who backs the alternatives' },
      { id: 'outcomeDiff', text: 'Differentiation tied to outcomes', next: 'Tie differentiation to outcomes' },
      { id: 'competingPriorities', text: 'Other priorities competing for the budget known', next: 'Check competing priorities' },
    ] },
  ];
  const BY_ID = Object.fromEntries(RUBRIC.map((L) => [L.id, L]));
  const OTHER = 'other';

  // Where a bullet's evidence came from. "assumption" never counts as evidence.
  const SOURCES = [
    { v: 'customer', label: 'Customer said' },
    { v: 'confirmed', label: 'Confirmed by 2+ people' },
    { v: 'assumption', label: 'Our assumption' },
    { v: 'notes', label: 'From notes' },          // shown as "From notes (date)" using the bullet's noteDate
  ];

  const LEVELS = {
    none: { dots: 0, label: 'Not started' },
    gap: { dots: 1, label: 'Gap' },
    partial: { dots: 2, label: 'Partial' },
    strong: { dots: 3, label: 'Strong' },
  };

  /* ------------------------------------------------------------------ scoring */
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const hasText = (b) => !!(b && norm(b.text));
  // A bullet is evidence when it has text, isn't our own assumption and isn't flagged as a risk.
  const isEvidence = (b) => hasText(b) && b.source !== 'assumption' && !b.risk;

  /**
   * Strength of one MEDDPICC letter, always calculated from its bullets (never stored).
   * @param {string|object} letter  letter id (e.g. 'champion') or a RUBRIC entry
   * @param {object[]} bullets      that letter's bullets
   * @returns {{letter, level, dots, label, met: string[], metCount, total, risk, riskCount, next, nextCriterion}}
   */
  function scoreLetter(letter, bullets) {
    const L = typeof letter === 'string' ? BY_ID[letter] : letter;
    if (!L || !Array.isArray(L.criteria)) throw new Error('Unknown MEDDPICC letter: ' + letter);
    const list = (Array.isArray(bullets) ? bullets : []).filter(hasText);
    const met = [];
    for (const c of L.criteria) {
      if (c.rule === 'twoPeople') {
        // Economic Buyer "confirmed by two or more people": a bullet sourced "Confirmed by 2+ people",
        // or two met bullets (about who the EB is) naming different people.
        const tags = [c.id, ...(c.alsoFrom || [])];
        const cand = list.filter((b) => isEvidence(b) && tags.includes(b.criterion));
        const people = new Set(cand.map((b) => norm(b.who)).filter(Boolean));
        if (cand.some((b) => b.source === 'confirmed') || people.size >= 2) met.push(c.id);
      } else if (list.some((b) => b.criterion === c.id && isEvidence(b))) met.push(c.id);
    }
    const total = L.criteria.length, n = met.length;
    const requiredOk = L.criteria.every((c) => !c.required || met.includes(c.id));
    const riskCount = list.filter((b) => b.risk).length;
    let level = n === 0 ? 'none' : n / total < 0.5 ? 'gap' : requiredOk && n / total >= 0.75 ? 'strong' : 'partial';
    if (riskCount && level === 'strong') level = 'partial';          // any risk caps the letter at Partial
    const missing = L.criteria.filter((c) => !met.includes(c.id));
    const nextC = missing.find((c) => c.required) || missing[0] || null;
    const next = nextC ? nextC.next : riskCount ? 'Resolve the flagged risk' : 'Strong: keep it current';
    return { letter: L.id, level, dots: LEVELS[level].dots, label: LEVELS[level].label, met, metCount: n, total,
      risk: riskCount > 0, riskCount, next, nextCriterion: nextC ? nextC.id : null };
  }

  /* ------------------------------------------------------------------ notes → sentences */
  const HEADINGS = new Set(['summary', 'notes', 'note', 'next steps', 'action items', 'actions', 'agenda', 'attendees', 'recap', 'pain', 'pains',
    'metrics', 'decision', 'decision criteria', 'decision process', 'budget', 'timeline', 'customer', 'q', 'a', 'risk', 'risks', 'competition',
    'champion', 'paper process', 'economic buyer', 'background', 'context', 'meeting', 'date', 'subject', 'topic', 'outcome', 'todo', 'follow up', 'follow-up']);
  const NAME = "[A-Z][\\w.'’-]*(?:\\s+[A-Z][\\w.'’-]*){0,3}";
  const RE_ZOOM_HEADER = new RegExp('^(' + NAME + ')\\s{2,}(?:\\d{1,2}:)?\\d{1,2}:\\d{2}\\s*$');   // "Maria Gomez  00:00:21"
  const RE_SPEAKER = new RegExp('^(' + NAME + ')\\s*:\\s+(.+)$');                                    // "Maria Gomez: text"
  const RE_TS = /^[[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?[\])]?\s*[-–]?\s*/;                     // "[00:01:02] "
  const isSpeakerName = (s) => !HEADINGS.has(norm(s)) && s.length <= 40;

  /** Split raw notes / transcripts (.txt, .md, Zoom, .vtt, .srt) into sentences with a speaker when known. */
  function parseNotes(raw) {
    const out = [];
    let speaker = '';
    const lines = String(raw || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (/^WEBVTT/i.test(line) || /^NOTE\b/.test(line) || /^\d+$/.test(line) || line.includes('-->')) continue;   // vtt/srt scaffolding
      const zh = RE_ZOOM_HEADER.exec(line);
      if (zh) { speaker = zh[1]; continue; }
      const v = /^<v(?:\.[^\s>]+)?\s+([^>]+)>(.*)$/i.exec(line);
      if (v) { speaker = v[1].trim(); line = v[2]; }
      line = line.replace(/<\/?[^>]+>/g, '').replace(RE_TS, '').replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim();
      if (!line) continue;
      const sp = RE_SPEAKER.exec(line);
      if (sp && isSpeakerName(sp[1])) { speaker = sp[1]; line = sp[2].trim(); }
      else if (/^[^:]{1,40}:$/.test(line)) { speaker = ''; continue; }   // a heading line such as "Next steps:"
      for (const s of line.split(/(?<=[.!?])\s+(?=["'“(A-Z0-9])/)) {
        const text = s.trim();
        if (text.replace(/[^a-z]/gi, '').length >= 10) out.push({ speaker, text });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ keyword rules */
  // Each rule maps a phrase pattern to a letter + criterion. risk: true suggests flagging the bullet as a risk.
  // Patterns are deliberately plain so they're easy to extend.
  const NUM = '(?:\\d[\\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';
  const RULES = [
    // ---- risks first (they win ties)
    { l: 'decisionCriteria', c: 'captured', risk: true, re: /\b(rfp|criteria|requirements?|specs?|specifications?)\b[^.]{0,40}\b(written|built|tailored|designed|wired)\s+(around|for|to favou?r)\b/i },
    { l: 'champion', c: 'tested', risk: true, re: /\b(champion|contact|sponsor|advocate)\b[^.]{0,40}\b(left|leaving|quit|moved on|reassigned|went quiet|stopped responding|going dark)\b|\b(wouldn'?t|won'?t|refused to|failed to|didn'?t|did not) (introduce|intro|share|set up|get us)\b/i },
    { l: 'economicBuyer', c: 'funding', risk: true, re: /\b(no budget|budget (was |has been |is |got )?(cut|frozen|pulled|on hold|slashed)|don'?t have (the |any )?budget|unfunded)\b|\b(cfo|cio|cto|eb|economic buyer)\b[^.]{0,30}\b(not (convinced|interested|on board)|pushed back|said no)\b/i },
    { l: 'identifiedPain', c: 'compellingEvent', risk: true, re: /\b(not (a|the|really a) priority|no (real )?urgency|on hold|put on ice|paused|pushed (out|back) to|can wait|nice to have)\b/i },
    { l: 'competition', c: 'alternatives', risk: true, re: /\b((lower|cheaper|better) (price|quote|bid|offer)|incumbent advantage|already (bought|purchased|committed|signed)|leaning (towards?|to) (vmware|azure|aws|hyper-?v|dell|hpe|vxrail|the competitor|them))\b/i },

    // ---- M · Metrics
    { l: 'metrics', c: 'customerOwned', re: /\b(reduce|cut|save|lower|improve|increase|decrease|shrink|speed up|free up|reclaim|consolidate)\b[^.]{0,60}\d|\d[\d,.]*\s?(%|percent)\s+(less|more|faster|lower|higher|reduction|savings?)\b/i },
    { l: 'metrics', c: 'businessOutcome', re: /\b(tco|roi|opex|capex|cost savings?|save money|(reduce|lower|cut) (our |their )?costs?|revenue|business outcomes?|payback|reduce (the )?risk)\b/i },
    { l: 'metrics', c: 'baselineTarget', re: /\b(from|currently|today|right now)\b[^.]{0,40}\d[^.]{0,40}\b(to|down to|under|below|target|goal)\b[^.]{0,20}\d/i },
    { l: 'metrics', c: 'technicalMeasure', re: /\b(success (criteria|measures?)|benchmarks?|iops|latency|rto|rpo|throughput|failover time|recovery time|performance targets?)\b/i },
    { l: 'metrics', c: 'ebAgreed', re: /\b(cio|cfo|cto|ceo|vp|superintendent|board|economic buyer|eb)\b[^.]{0,60}\b(agreed|signed off|approved|bought into|aligned on|wants to see)\b[^.]{0,40}\b(metrics?|numbers?|targets?|goals?|roi|savings|tco)\b/i },
    { l: 'metrics', c: 'proofPoint', re: /\b(reference (customer|call|account|site)|case study|customer story|similar (customer|district|school|county|hospital|college|university)|proof point|peer (district|customer))\b/i },

    // ---- E · Economic Buyer
    { l: 'economicBuyer', c: 'named', re: /\b(final (say|decision|sign[- ]?off|approval)|signs? (off on|off|the (po|contract|check|purchase order))|budget (holder|owner)|economic buyer|holds? the (budget|purse)|controls? the budget|approves? the (spend|purchase|budget))\b/i },
    { l: 'economicBuyer', c: 'confirmed2', re: /\b(also confirmed|both (said|confirmed)|confirmed (that|it'?s)|backed that up|verified that)\b[^.]{0,60}\b(sign|final|budget|decision|approv)/i },
    { l: 'economicBuyer', c: 'priorities', re: /\b(top priorit(y|ies)|strategic (priority|initiative|plan|goals?)|board (wants|priorit\w*)|(his|her|their) priorit(y|ies)|initiatives? for (this|next) year|focus (for|this) (year|quarter))\b/i },
    { l: 'economicBuyer', c: 'howMuch', re: /(\bbudget (is|of|around|range)\b|\$\s?\d|\bspend (about|around|up to)\b|\bhow (much|soon|sure)\b)/i },
    { l: 'economicBuyer', c: 'funding', re: /\b(budget (is |has been |was )?(approved|allocated|set aside|available|confirmed|secured|in place)|funded|funding (is |has been )?(approved|in place|secured|confirmed)|grant (was )?(approved|awarded)|money is there)\b/i },
    { l: 'economicBuyer', c: 'access', re: /\b(meet(ing)? with (the )?(cio|cfo|cto|ceo|vp|superintendent|eb|economic buyer)|intro(duce|duced|duction)? (us )?to (the )?(cio|cfo|cto|ceo|vp|superintendent)|exec(utive)? (briefing|meeting|sponsor|alignment))\b/i },

    // ---- D · Decision Criteria
    { l: 'decisionCriteria', c: 'captured', re: /\b(criteria|requirements?|must[- ]haves?|needs? to (support|have|integrate|run)|evaluat(e|ing|ion) (on|based on|against)|looking for (a|something)|scorecard)\b/i },
    { l: 'decisionCriteria', c: 'differentiator', re: /\b(nutanix|ahv|prism|nus|nkp|ndb|lifecycle manager|lcm|one[- ]click)\b[^.]{0,60}\b(differen\w*|unique|only|advantage|better|simpler|easier|stands? out)\b|\b(differen\w*|unique|advantage|only one)\b[^.]{0,60}\b(nutanix|ahv|prism)\b/i },
    { l: 'decisionCriteria', c: 'ranked', re: /\b(rank(ed|ing)?|weight(ed|ing)?|scor(ing|e) (sheet|card|matrix)|most important (thing|criteria|requirement)|top (priority|criteria|requirement)|number one (priority|requirement|thing))\b/i },
    { l: 'decisionCriteria', c: 'measurable', re: /\b(success criteria|measurable|kpis?|slas?|pass\/fail|must (achieve|hit|meet|deliver))\b/i },
    { l: 'decisionCriteria', c: 'agreed', re: /\b(stakeholders?|team|committee|everyone|they all|both teams)\b[^.]{0,20}\b(agreed|signed off|aligned|bought in)\b[^.]{0,40}\b(criteria|requirements?|on what)\b/i },

    // ---- D · Decision Process
    { l: 'decisionProcess', c: 'validation', re: /\b(poc|proof of concept|pilot|bake[- ]?off|reference calls?|trial|lab test(ing)?|test drive|demo environment|hands[- ]on (lab|test))\b/i },
    { l: 'decisionProcess', c: 'approval', re: /\b(approv(al|e|es|ed)|sign[- ]off|board (meeting|vote)|committee|steering|change (advisory )?board|cab)\b/i },
    { l: 'decisionProcess', c: 'timeline', re: /\b(by (the )?(end of (the )?(year|quarter|month|fy|fiscal year|summer)|january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])|deadline|go[- ]live|decision (by|date|in)|timeline|before (the )?(summer|holidays|renewal|school year))\b/i },
    { l: 'decisionProcess', c: 'stakeholders', re: /\b(stakeholders?|(it|security|network|storage|finance|procurement|infrastructure) (team|lead|manager|director)|involved in the decision|on the (buying|evaluation) committee|cares? (most )?about)\b/i },
    { l: 'decisionProcess', c: 'askedOthers', re: /\b(who else|anyone else (involved|who)|other (people|stakeholders) (involved|we should)|haven'?t met|not met (yet|with))\b/i },
    { l: 'decisionProcess', c: 'tdm', re: /\b(technical decision maker|tdm|(lead|chief|enterprise|solutions?) architect|infrastructure (manager|lead|director)|makes the technical (call|decision))\b/i },

    // ---- P · Paper Process
    { l: 'paperProcess', c: 'procurement', re: /\b(procurement|purchasing (department|team|process)|legal (review|team)?|contract review|security review|vendor (onboarding|risk|registration|setup)|msa|terms and conditions|redlines?|security questionnaire|infosec)\b/i },
    { l: 'paperProcess', c: 'reverseTimeline', re: /\b(reverse timeline|mutual (action|close|success) plan|work(ing)? back(wards?)? from|close plan)\b/i },
    { l: 'paperProcess', c: 'duration', re: new RegExp('\\b(takes?|took|usually|typically)\\b[^.]{0,20}\\b' + NUM + '\\s+(business )?(days?|weeks?|months?)\\b|\\bpo (takes|turnaround)\\b', 'i') },
    { l: 'paperProcess', c: 'route', re: /\b(reseller|distributor|var|partner|oem|cdw|shi|insight|carahsoft|td ?synnex|ingram|presidio|wwt|co[- ]?op|purchasing (contract|cooperative)|state contract|contract vehicle|gsa|sourcewell|naspo)\b/i },
    { l: 'paperProcess', c: 'budgetDeadlines', re: /\b(fiscal year|fy ?\d{2,4}|end of (the )?(fiscal|budget) year|use it or lose it|budget (cycle|deadline|expires|year)|june 30|grant (deadline|funding|money)|e-?rate)\b/i },

    // ---- I · Identified Pain
    { l: 'identifiedPain', c: 'businessPain', re: /\b(cost(ing|s)? (us|them)|too expensive|expensive|paying (way )?too much|price (increase|hike|went up)|licens(e|ing) (costs?|increase)|renewal (cost|quote|price|went up)|losing money|revenue|compliance|audit|outages?|downtime|breach|ransomware|broadcom)\b/i },
    { l: 'identifiedPain', c: 'quantified', test: (s) => /\b(cost|costs|spend|price|outage|outages|downtime|hours|tickets|renewal|license|licensing|increase|went up|paying)\b/i.test(s) && /(\d|\$)/.test(s) },
    { l: 'identifiedPain', c: 'technicalPain', re: /\b(slow|performance (issues?|problems?)|end of (life|support)|eol|out of support|complex(ity)?|hard to manage|aging|old hardware|running out of (space|capacity)|capacity (issues?|problems?)|bottlenecks?|keeps? (crashing|failing)|manual (process|work))\b/i },
    { l: 'identifiedPain', c: 'owner', re: /\b(owns? (this|the) (problem|issue|pain)|responsible for (fixing|solving)|on the hook|(his|her|their) (problem|headache) to solve)\b/i },
    { l: 'identifiedPain', c: 'compellingEvent', re: /\b(renewal (date|is|in|on|comes up)|contract (ends|expires|is up)|end of support|expires? (in|on|at the end)|lease (ends|expires|is up)|must be (off|out|done) (by|before)|before the contract)\b/i },
    { l: 'identifiedPain', c: 'statusQuo', re: /\b(do(ing)? nothing|status quo|cost of (waiting|delay|inaction)|if (we|they) (don'?t|do not) (change|move|act)|keep(ing)? (it )?as is)\b/i },

    // ---- C · Champion
    { l: 'champion', c: 'identified', re: /\b(champion|advocate|in our corner|pushing for (us|nutanix)|wants? (us|nutanix) to win|internal sponsor|on our side|fan of nutanix|sold on nutanix)\b/i },
    { l: 'champion', c: 'tested', re: /\b(introduced us to|intro(duced)? (us )?to (the )?(cio|cfo|cto|ceo|vp|eb|economic buyer|boss|superintendent)|walked us through|shared (the|their|her|his) (internal|business case|deck|pitch|budget)|told us how (the )?decision|set up (a|the) meeting with (the )?(cio|cfo|cto|vp))\b/i },
    { l: 'champion', c: 'personalWin', re: /\b(promotion|career|look good|(his|her|their) (goal|win|bonus|reputation)|get (the )?credit|wants to be seen|personal win)\b/i },
    { l: 'champion', c: 'techChampion', re: /\b(engineers?|admins?|architects?|sysadmins?|technical (lead|team)|it team)\b[^.]{0,50}\b(love|loves|like|likes|prefer|prefers|excited|impressed|bought in|on board|really want)\b/i },
    { l: 'champion', c: 'endorsed', re: /\b(endorsed|signed off on|happy with|agrees? with|approved|comfortable with)\s+(the |our )?(sizing|design|bom|solution|architecture|proposal|config(uration)?)\b/i },
    { l: 'champion', c: 'second', re: /\b(second champion|another champion|also (supportive|on board|a fan)|(both|two) of them (support|back|like))\b/i },

    // ---- C · Competition
    { l: 'competition', c: 'alternatives', re: /\b(vmware|vsphere|vsan|broadcom|hyper-?v|azure( stack)?|aws|gcp|google cloud|public cloud|cloud[- ]first|simplivity|vxrail|pure storage|netapp|proxmox|openstack|openshift|in[- ]house|build (it )?ourselves|competitors?|competing (bid|vendor|proposal)|also looking at|other vendors?)\b/i },
    { l: 'competition', c: 'strategy', re: /\b(head[- ]to[- ]head|change the (criteria|conversation)|land and expand|win (a|the) (part|piece|first workload)|slow (it|things) down|position (ourselves )?against|competitive strategy|wedge)\b/i },
    { l: 'competition', c: 'statusQuoCost', re: /\b(cost of (staying|doing nothing|the status quo)|staying (on|with)[^.]{0,40}\b(cost|expensive|increase))\b/i },
    { l: 'competition', c: 'backers', re: /\b(prefers?|pushing for|backing|wants to stay (on|with)|loyal to|favou?rs?|in bed with)\b[^.]{0,30}\b(vmware|azure|aws|hyper-?v|dell|hpe|cisco|pure|netapp|incumbent|competitor|the other vendor)\b/i },
    { l: 'competition', c: 'outcomeDiff', re: /\b(differen\w*|advantage|better than|versus|vs\.?|compared (to|with))\b[^.]{0,80}\b(cost|savings?|time|faster|simpler|outcome|risk|tco)\b/i },
    { l: 'competition', c: 'competingPriorities', re: /\b(competing priorit(y|ies)|other (projects|priorities|initiatives)|budget (also|might|could) (go|be used)|instead of this|erp (project|upgrade))\b/i },
  ];

  /* ------------------------------------------------------------------ extraction */
  const FILLER = /\b(um+|uh+|erm|you know|i mean|kind of|sort of|basically)\b,?\s*/gi;
  const tidy = (s) => {
    let t = s.replace(FILLER, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
    t = t.replace(/^(so|and|but|well|yeah|okay|ok|right),?\s+/i, '');
    if (t.length > 240) t = t.slice(0, 237).replace(/\s+\S*$/, '') + '…';
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const tokens = (s) => new Set(norm(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length >= 3));
  function similar(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x.includes(y) || y.includes(x)) return true;
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return false;
    let inter = 0; for (const w of A) if (B.has(w)) inter++;
    return inter / (A.size + B.size - inter) >= 0.6;
  }
  const isRequired = (rubric, l, c) => { const L = rubric.find((x) => x.id === l); const C = L && L.criteria.find((x) => x.id === c); return !!(C && C.required); };

  /**
   * Rule-based extractor (default). Notes stay in the browser: nothing is sent anywhere.
   * @param {string|{text,date,attendees}} notes
   * @param {object} existingBullets  the deal's `meddpicc` object (bullets keyed by letter id); used to skip duplicates
   * @param {object[]} rubric         RUBRIC (or an edited copy)
   * @returns {object[]} proposals: { id, letter, criterion, text, quote, who, risk, source: 'notes', noteDate }
   */
  function ruleBasedExtractor(notes, existingBullets, rubric) {
    const n = typeof notes === 'string' ? { text: notes } : (notes || {});
    const date = n.date || new Date().toISOString().slice(0, 10);
    const attendees = String(n.attendees || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    const known = new Set(rubric.flatMap((L) => L.criteria.map((c) => L.id + '/' + c.id)));
    const existing = existingBullets || {};
    const perCriterion = new Map();      // "letter/criterion" -> count (at most 2 proposals each)
    const out = [];
    for (const { speaker, text } of parseNotes(n.text)) {
      const hits = [];
      RULES.forEach((r, i) => {
        if (!known.has(r.l + '/' + r.c)) return;
        if (r.re ? r.re.test(text) : r.test(text)) hits.push({ r, i, score: (r.risk ? 2 : 0) + (isRequired(rubric, r.l, r.c) ? 1 : 0) });
      });
      if (!hits.length) continue;
      hits.sort((a, b) => b.score - a.score || a.i - b.i);
      const perLetter = {}, seenCrit = new Set();
      let taken = 0;
      const who = speaker || attendees.find((a) => new RegExp('\\b' + a.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)) || '';
      for (const { r } of hits) {
        const key = r.l + '/' + r.c;
        if (taken >= 3 || seenCrit.has(key) || (perLetter[r.l] || 0) >= 2 || (perCriterion.get(key) || 0) >= 2) continue;
        const clean = tidy(text);
        if ((existing[r.l] || []).some((b) => b && b.criterion === r.c && similar(b.text, clean))) continue;   // already captured
        if (out.some((p) => p.letter === r.l && p.criterion === r.c && similar(p.text, clean))) continue;
        out.push({ id: 'p' + out.length, letter: r.l, criterion: r.c, text: clean, quote: text, who, risk: !!r.risk, source: 'notes', noteDate: date });
        seenCrit.add(key); perLetter[r.l] = (perLetter[r.l] || 0) + 1; perCriterion.set(key, (perCriterion.get(key) || 0) + 1); taken++;
      }
    }
    const order = rubric.map((L) => L.id);
    return out.sort((a, b) => order.indexOf(a.letter) - order.indexOf(b.letter));
  }

  /* ---- Extraction hook -------------------------------------------------------------------------------
   * To use an approved AI model later, call setExtractor(fn) with the same signature:
   *   fn(notes, existingBullets, rubric) -> proposals[]   (sync or returning a Promise)
   * and build its structured-output schema from RUBRIC (letter ids + criterion ids).
   * Meeting notes contain confidential customer information: only send them to a service that has been approved.
   * --------------------------------------------------------------------------------------------------- */
  let extractor = ruleBasedExtractor;
  const setExtractor = (fn) => { extractor = typeof fn === 'function' ? fn : ruleBasedExtractor; };
  function extractMeddpiccFromNotes(notes, existingBullets, rubric) {
    return extractor(notes, existingBullets || {}, rubric || RUBRIC);
  }

  root.MEDDPICC = { RUBRIC, BY_ID, OTHER, SOURCES, LEVELS, RULES, scoreLetter, parseNotes, extractMeddpiccFromNotes, ruleBasedExtractor, setExtractor, similar };
})(typeof window !== 'undefined' ? window : globalThis);
