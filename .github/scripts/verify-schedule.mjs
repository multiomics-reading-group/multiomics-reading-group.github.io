#!/usr/bin/env node
// Checks data/schedule.json before it goes live: the file's shape, and that
// each linked paper's title matches what its DOI registry says.
//
//   node .github/scripts/verify-schedule.mjs                 # every talk
//   node .github/scripts/verify-schedule.mjs --base <ref>    # talks changed since <ref>
//   ... --strict                                             # warnings fail too
//
// Structural checks always cover the whole file. The per-talk checks (paper
// lookups, leftover doc formatting, DOI link format) only run on changed talks
// when --base is given, so legacy rows don't block unrelated updates.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'data/schedule.json';
const TALK_KEYS = new Set(['date', 'speaker', 'affiliation', 'title', 'note', 'paper', 'startHour', 'endHour']);
const TEXT_KEYS = ['speaker', 'affiliation', 'title', 'note'];
const USER_AGENT = 'multiomics-reading-group-schedule-check (+https://github.com/multiomics-reading-group/multiomics-reading-group.github.io)';

const errors = [];
const warnings = [];
const text = readFileSync(FILE, 'utf8');
const lines = text.split('\n');

// Annotations point at the talk's own line so they show up inline on the PR.
const lineOf = (date) => {
  const i = date ? lines.findIndex(l => l.includes(`"date": "${date}"`)) : -1;
  return i >= 0 ? i + 1 : 1;
};
const error = (msg, date) => errors.push({ msg: date ? `${date}: ${msg}` : msg, line: lineOf(date) });
const warn = (msg, date) => warnings.push({ msg: date ? `${date}: ${msg}` : msg, line: lineOf(date) });

function finish() {
  // --strict fails on warnings too: anything the checks could not confirm (an
  // OpenReview title, a missing paper link) then keeps an automated PR open
  // until a person has looked at it.
  const strict = process.argv.includes('--strict');
  const warnLevel = strict ? 'error' : 'warning';
  const gha = process.env.GITHUB_ACTIONS === 'true';
  const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const w of warnings) console.log(gha ? `::${warnLevel} file=${FILE},line=${w.line}::${esc(w.msg)}` : `${warnLevel}: ${w.msg}`);
  for (const e of errors) console.log(gha ? `::error file=${FILE},line=${e.line}::${esc(e.msg)}` : `error: ${e.msg}`);
  const strictNote = strict && warnings.length ? ' (--strict: warnings fail the check)' : '';
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)${strictNote}`);
  process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
}

// ---- Structure (whole file) ----

let data;
try {
  data = JSON.parse(text);
} catch (e) {
  error(`not valid JSON: ${e.message}`);
  finish();
}

if (typeof data.time !== 'string') error('top-level "time" must be a string');
if (!Array.isArray(data.sessions)) {
  error('top-level "sessions" must be an array');
  finish();
}

const isRealDate = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T12:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

const talks = [];
const seenDates = new Set();
for (const session of data.sessions) {
  if (typeof session.name !== 'string' || !Array.isArray(session.talks)) {
    error('every session needs a "name" string and a "talks" array');
    continue;
  }
  let previous = null;
  for (const talk of session.talks) {
    const { date } = talk;
    if (!isRealDate(date)) {
      error(`talk in "${session.name}" has a malformed date: ${JSON.stringify(date)}`);
      continue;
    }
    if (seenDates.has(date)) error('date appears more than once', date);
    seenDates.add(date);
    if (previous && date >= previous) error(`out of order after ${previous}; talks in a session go newest first`, date);
    previous = date;

    for (const key of Object.keys(talk)) {
      if (!TALK_KEYS.has(key)) error(`unknown field "${key}"`, date);
    }
    for (const key of TEXT_KEYS) {
      if (typeof talk[key] !== 'string') error(`"${key}" must be a string (use "" when empty)`, date);
    }
    if ('paper' in talk && !(typeof talk.paper === 'string' && talk.paper.startsWith('https://'))) {
      error('"paper" must be an https:// URL', date);
    }
    if (('startHour' in talk) !== ('endHour' in talk)) {
      error('"startHour" and "endHour" go together', date);
    } else if ('startHour' in talk) {
      const { startHour: s, endHour: e } = talk;
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 24 || s >= e) {
        error(`hours must be whole numbers with 0 <= startHour < endHour <= 24 (got ${s}–${e})`, date);
      }
    }
    talks.push({ talk, session: session.name });
  }
}

// ---- Which talks to check in depth ----

const baseIdx = process.argv.indexOf('--base');
const base = baseIdx >= 0 ? process.argv[baseIdx + 1] : null;
const signature = ({ talk, session }) => JSON.stringify({ ...talk, session });

let toCheck = talks;
if (base) {
  try {
    const old = JSON.parse(execFileSync('git', ['show', `${base}:${FILE}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }));
    const before = new Set();
    for (const s of old.sessions ?? []) {
      for (const t of s.talks ?? []) before.add(signature({ talk: t, session: s.name }));
    }
    toCheck = talks.filter(entry => !before.has(signature(entry)));
    console.log(`${toCheck.length} talk(s) new or changed since ${base}`);
  } catch {
    warn(`could not read ${FILE} at ${base}; checking every talk`);
  }
}

// ---- Per-talk content ----

// arXiv and bioRxiv/medRxiv links all have a DOI, and CLAUDE.md asks for it.
function doiFor(url) {
  const arxiv = url.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})/i);
  if (arxiv) return `10.48550/arXiv.${arxiv[1]}`;
  const rxiv = url.match(/(?:bio|med)rxiv\.org\/content\/(10\.\d{4,9}\/[^?#]+?)(?:v\d+)?(?:\.full(?:\.pdf)?)?(?:[?#].*)?$/i);
  if (rxiv) return rxiv[1];
  return null;
}

const normalizeTitle = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/<[^>]+>/g, ' ')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

async function fetchWithRetry(url, headers = {}) {
  let problem = 'no response';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 2000 * attempt));
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok || res.status === 404) return { res };
      problem = `HTTP ${res.status}`;
    } catch (e) {
      problem = e.message;
    }
  }
  return { problem };
}

// The title the paper's registry has on record, or { problem } explaining why
// there isn't one.
async function registryTitle(url) {
  const doi = url.match(/^https:\/\/doi\.org\/(10\.\d{4,9}\/.+)$/)?.[1];
  if (doi) {
    // Content negotiation works for both Crossref (bioRxiv) and DataCite (arXiv).
    const { res, problem } = await fetchWithRetry(`https://doi.org/${doi}`, {
      Accept: 'application/vnd.citationstyles.csl+json',
    });
    if (problem) return { problem: `DOI lookup failed (${problem})` };
    if (res.status === 404) return { problem: 'DOI does not resolve', fatal: true };
    const title = (await res.json()).title;
    return { title: Array.isArray(title) ? title[0] : title, source: 'DOI registry' };
  }

  const openreview = url.match(/^https:\/\/openreview\.net\/(?:forum|pdf)\?id=([\w-]+)/)?.[1];
  if (openreview) {
    const { res, problem } = await fetchWithRetry(`https://api2.openreview.net/notes?id=${openreview}`);
    if (problem || res.status === 404) return { problem: `OpenReview lookup failed (${problem ?? 'HTTP 404'})` };
    const content = (await res.json()).notes?.[0]?.content ?? {};
    const title = content.title?.value ?? content.title;
    return typeof title === 'string' ? { title, source: 'OpenReview' } : { problem: 'OpenReview returned no title' };
  }

  return { problem: 'not a DOI or OpenReview link, so the title was not checked' };
}

for (const { talk } of toCheck) {
  const { date } = talk;

  for (const key of TEXT_KEYS) {
    const value = talk[key];
    if (typeof value !== 'string') continue;
    if (value !== value.trim()) error(`"${key}" has leading or trailing whitespace`, date);
    if (/\*|\\|&#?\w+;/.test(value)) error(`"${key}" looks like it kept formatting from the doc: ${JSON.stringify(value)}`, date);
  }

  if (new Date(`${date}T12:00:00Z`).getUTCDay() !== 3) warn('is not a Wednesday', date);

  if (!talk.paper) {
    if (talk.title && talk.title !== 'TBA') warn('has a title but no paper link', date);
    continue;
  }

  const suggested = doiFor(talk.paper);
  if (suggested) {
    error(`link the DOI instead: "paper": "https://doi.org/${suggested}"`, date);
    continue;
  }

  const result = await registryTitle(talk.paper);
  if (result.problem) {
    (result.fatal ? error : warn)(`${result.problem}: ${talk.paper}`, date);
    continue;
  }
  if (normalizeTitle(result.title) !== normalizeTitle(talk.title)) {
    error(`title does not match the ${result.source}. Schedule: ${JSON.stringify(talk.title)} / ${result.source}: ${JSON.stringify(result.title)}`, date);
  } else {
    console.log(`ok ${date}: title matches the ${result.source}`);
  }
}

finish();
