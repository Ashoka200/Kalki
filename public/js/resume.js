/* Resume + job-application toolkit. Everything runs on-device: your
   resume never leaves the phone. Paste a job description and Kalki
   scores the match the way an ATS would, names the missing keywords,
   and writes a cover letter tailored to that posting. */
import { store } from './store.js';

/* ---------- resume storage ---------- */

export const getResume = () => store.get('resume', '');
export function setResume(text) {
  store.set('resume', String(text || '').slice(0, 20000));
  return profileFromResume();
}
export const hasResume = () => getResume().length > 80;

/** Rough facts pulled out of the resume for letter-writing. */
export function profileFromResume() {
  const r = getResume();
  if (!r) return null;
  const years = [...r.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => +m[0]).filter((y) => y >= 1975 && y <= new Date().getFullYear());
  const span = years.length >= 2 ? Math.max(0, Math.max(...years) - Math.min(...years)) : null;
  const stated = r.match(/\b(\d{1,2})\+?\s*years?\b/i);
  const title = (r.split('\n').map((l) => l.trim()).find((l) =>
    l.length > 3 && l.length < 60 && /\b(analyst|manager|engineer|developer|director|lead|specialist|consultant|associate|designer|scientist|accountant|controller|architect)\b/i.test(l)) || '').replace(/[|,–-].*$/, '').trim();
  return { title: title || null, years: stated ? +stated[1] : span };
}

/* ---------- keyword extraction ---------- */

const LEXICON = [
  // finance & analysis
  'fp&a', 'forecasting', 'budgeting', 'variance analysis', 'financial modeling', 'financial modelling',
  'valuation', 'dcf', 'gaap', 'ifrs', 'month-end close', 'reconciliation', 'audit', 'cash flow',
  'p&l', 'kpi', 'cost accounting', 'revenue recognition', 'accruals', 'erp', 'netsuite', 'sap', 'oracle',
  'hyperion', 'anaplan', 'quickbooks', 'workday', 'planning', 'reporting', 'compliance',
  // data & tech
  'excel', 'sql', 'python', 'r', 'power bi', 'tableau', 'looker', 'javascript', 'typescript', 'java',
  'react', 'node', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'git',
  'machine learning', 'etl', 'snowflake', 'databricks', 'api', 'automation',
  // ways of working
  'stakeholder management', 'cross-functional', 'leadership', 'mentoring', 'agile', 'scrum',
  'communication', 'presentation', 'project management', 'process improvement', 'strategy',
];

const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'this', 'that', 'have', 'from', 'your', 'their', 'about', 'into', 'must', 'work', 'team', 'role', 'able', 'they', 'them', 'more', 'other', 'within', 'across', 'including', 'strong', 'ability', 'years', 'experience', 'skills', 'requirements', 'responsibilities', 'preferred', 'plus', 'etc']);

/** Keywords an ATS would likely weight, most important first. */
function jobKeywords(jd) {
  const text = String(jd || '').toLowerCase();
  const found = new Map();

  for (const term of LEXICON) {
    if (text.includes(term)) found.set(term, 3); // known skills score highest
  }
  // phrases after requirement cues
  for (const m of text.matchAll(/(?:experience (?:with|in|using)|proficien\w+ (?:in|with)|knowledge of|familiar\w* with|skills? in)\s+([a-z0-9+#&.\/ -]{3,40})/g)) {
    m[1].split(/,| and | or /).map((s) => s.trim()).filter((s) => s.length > 2).forEach((s) => found.set(s, (found.get(s) || 0) + 2));
  }
  // frequent meaningful words
  const freq = new Map();
  for (const w of text.match(/[a-z][a-z+#&.\/-]{3,}/g) || []) {
    if (STOP.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  [...freq.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([w, n]) => found.set(w, (found.get(w) || 0) + Math.min(n / 3, 2)));

  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 25);
}

/* Section headings a pasted posting runs into — used to stop a field
   from swallowing the rest of the ad when newlines are lost (which is
   exactly what happens when someone pastes into a single-line box). */
const SECTIONS = /\b(?:company|employer|organization|location|salary|compensation|responsibilities|requirements|qualifications|about|role|position|job type|department|reports to|posted|apply)\b\s*[:\-]/i;

function cleanField(v, max = 60) {
  if (!v) return null;
  let s = String(v).split(/[\n\r]/)[0];
  const cut = s.search(SECTIONS);
  if (cut > 0) s = s.slice(0, cut);
  s = s.replace(/\s{2,}.*$/, '').replace(/[·|,;.\-\s]+$/, '').trim();
  return s.length > 1 ? s.slice(0, max) : null;
}

/** Role and company, if the posting states them plainly. */
export function jobMeta(jd) {
  const t = String(jd || '');
  const role = (t.match(/(?:job title|position|role)\s*[:\-]\s*(.{3,70})/i)
    || t.match(/^\s*([A-Z][A-Za-z&,\/ -]{3,50}(?:Analyst|Manager|Engineer|Developer|Director|Lead|Specialist|Consultant|Associate|Designer|Scientist|Accountant|Controller|Architect))\s*$/m) || [])[1];
  const company = (t.match(/(?:company|employer|organization)\s*[:\-]\s*(.{2,60})/i)
    || t.match(/\bat\s+([A-Z][A-Za-z0-9&.\' -]{2,40}?)(?:\s+(?:is|we|are|in|as)\b|[,.\n])/) || [])[1];
  return { role: cleanField(role), company: cleanField(company, 50) };
}

/* ---------- match scoring ---------- */

export function matchReport(jd) {
  const resume = getResume().toLowerCase();
  const keys = jobKeywords(jd);
  const have = keys.filter((k) => resume.includes(k));
  const missing = keys.filter((k) => !resume.includes(k));
  const score = keys.length ? Math.round((have.length / keys.length) * 100) : 0;
  return { score, have, missing: missing.slice(0, 10), keys };
}

/* ---------- cover letter ---------- */

export const DEFAULT_TEMPLATE = `Dear Hiring Manager,

I'm writing to apply for the {role} role{at_company}. {intro}

{strengths}

{closer}

Best regards,
{name}{contact}`;

export const getTemplate = () => store.get('coverTemplate', DEFAULT_TEMPLATE);
export const setTemplate = (t) => store.set('coverTemplate', String(t || '').slice(0, 4000));
export const getTone = () => store.get('coverTone', 'professional');
export const setTone = (t) => store.set('coverTone', t);

const TONES = {
  professional: {
    intro: (p) => `With ${p.years ? `${p.years} years` : 'a track record'} in ${p.field}, I believe I can make an immediate contribution to your team.`,
    closer: 'I would welcome the chance to discuss how my background matches your needs. Thank you for your consideration.',
  },
  warm: {
    intro: (p) => `I've been following this kind of work for a while, and with ${p.years ? `${p.years} years` : 'my experience'} in ${p.field}, this role feels like a genuine fit.`,
    closer: 'I would love to talk about how I could help your team. Thanks so much for reading.',
  },
  direct: {
    intro: (p) => `${p.years ? `${p.years} years` : 'My career'} in ${p.field}, and here is why I fit this role.`,
    closer: 'Happy to walk through any of this on a call. Thank you for your time.',
  },
};

/** A cover letter mirroring this posting's own language. */
export function coverLetter(jd, { role, company } = {}) {
  const meta = jobMeta(jd);
  const finalRole = role || meta.role || 'this';
  const finalCompany = company || meta.company;
  const { have } = matchReport(jd);
  const p = profileFromResume() || {};
  const prof = store.get('profile', {});
  const tone = TONES[getTone()] || TONES.professional;
  const field = p.title ? p.title.toLowerCase() : (have[0] || 'the field');

  const top = have.slice(0, 4);
  const strengths = top.length
    ? `Your posting emphasises ${top.slice(0, 3).join(', ')}${top.length > 3 ? ` and ${top[3]}` : ''} — these are central to my work. My resume shows where I have applied each of them and the results they produced.`
    : 'My resume sets out the experience most relevant to what you have described.';

  const name = [prof.firstName || prof.name, prof.lastName].filter(Boolean).join(' ') || prof.name || '';
  const contact = [prof.email, prof.phone].filter(Boolean).join(' · ');

  return getTemplate()
    .replace('{role}', finalRole)
    .replace('{at_company}', finalCompany ? ` at ${finalCompany}` : '')
    .replace('{intro}', tone.intro({ years: p.years, field }))
    .replace('{strengths}', strengths)
    .replace('{closer}', tone.closer)
    .replace('{name}', name)
    .replace('{contact}', contact ? `\n${contact}` : '');
}

/* ---------- application tracker ---------- */

export const listApplications = () => store.get('applications', []).sort((a, b) => b.ts - a.ts);

export function addApplication(app) {
  const all = store.get('applications', []);
  const rec = { id: Date.now().toString(36), status: 'applied', ts: Date.now(), ...app };
  all.push(rec);
  store.set('applications', all);
  return rec;
}

export function setApplicationStatus(id, status) {
  store.set('applications', store.get('applications', []).map((a) => (a.id === id ? { ...a, status } : a)));
}

/** "applied to acme", "mark acme interview", "my applications". */
export function parseApplicationCmd(text) {
  const t = text.trim();
  if (/^(?:show\s+)?(?:my\s+)?(?:applications?|job applications?|applied jobs?)$/i.test(t)) return { op: 'list' };
  const m = t.match(/^(?:mark|update)\s+(.+?)\s+(?:as\s+)?(interview(?:ing)?|offer|rejected|accepted|applied)$/i);
  if (m) return { op: 'status', name: m[1].trim(), status: m[2].toLowerCase().replace('interviewing', 'interview') };
  return null;
}

export const STATUS_ICON = { applied: '📨', interview: '🗣️', offer: '🎉', accepted: '✅', rejected: '❌' };
