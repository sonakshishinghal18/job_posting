/* Lumen frontend
   - localStorage cache: same query max 2x/day, silent return after
   - Sort tabs: Relevance / Date / Match (batch-score top 15)
   - Rewrite resume bullets in detail panel
   - Location dropdown: Bangalore / Delhi NCR / Both
*/

const RESUME_KEY = 'lumen.resume.v1';
const CACHE_KEY  = 'lumen.cache.v1';

// ---- DOM ----
const form = document.getElementById('searchForm');
const queryEl = document.getElementById('query');
const expEl = document.getElementById('experience');
const locEl = document.getElementById('location');
const searchBtn = document.getElementById('searchBtn');
const grid = document.getElementById('grid');
const meta = document.getElementById('resultsMeta');
const resultCount = document.getElementById('resultCount');
const resultCtx = document.getElementById('resultContext');
const pageNumEl = document.getElementById('pageNum');
const errorBox = document.getElementById('errorBox');
const pagination = document.getElementById('pagination');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const panel = document.getElementById('panel');
const panelInner = document.getElementById('panelInner');
const panelClose = document.getElementById('panelClose');
const panelScrim = document.getElementById('panelScrim');
const resumeBtn = document.getElementById('resumeBtn');
const resumeBtnLabel = document.getElementById('resumeBtnLabel');
const modalScrim = document.getElementById('modalScrim');
const modalClose = document.getElementById('modalClose');
const uploader = document.getElementById('uploader');
const browseBtn = document.getElementById('browseBtn');
const fileInput = document.getElementById('fileInput');
const modalStatus = document.getElementById('modalStatus');
const clearResumeBtn = document.getElementById('clearResumeBtn');
const sortTabs = document.getElementById('sortTabs');
const sortMatchTab = document.getElementById('sortMatchTab');

let state = {
  page: 1,
  lastQuery: '',
  lastExp: '',
  lastLoc: 'bangalore',
  jobsById: {},
  jobsList: [],
  hasResults: false,
  currentSort: 'relevance',
  batchScores: {},  // { jobId: score }
};

// ---- helpers ----
function esc(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtRel(ts) {
  if (!ts) return '';
  const d = Date.now()/1000 - ts;
  if (d < 3600) return `${Math.max(1, Math.round(d/60))}m ago`;
  if (d < 86400) return `${Math.round(d/3600)}h ago`;
  return `${Math.round(d/86400)}d ago`;
}
function locStr(j) { return [j.city, j.state].filter(Boolean).join(', ') || 'India'; }
function initials(n) { return n ? n.split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase() : '·'; }

// ============================================================
//  CACHE — localStorage, 2x per day per query key
// ============================================================
function cacheKey(query, exp, loc, page) {
  return `${query.toLowerCase().trim()}|${exp}|${loc}|${page}`;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

function getCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function setCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}
function getCachedResult(key) {
  const c = getCache();
  const entry = c[key];
  if (!entry || entry.date !== todayStr()) return null;
  return entry;
}
function saveCacheResult(key, data) {
  const c = getCache();
  const existing = c[key];
  const today = todayStr();
  if (existing && existing.date === today) {
    existing.count = (existing.count || 1) + 1;
    existing.data = data;
  } else {
    c[key] = { date: today, count: 1, data };
  }
  // Prune old entries
  for (const k of Object.keys(c)) {
    if (c[k].date !== today) delete c[k];
  }
  setCache(c);
}
function canFetchFresh(key) {
  const entry = getCachedResult(key);
  if (!entry) return true;
  return (entry.count || 0) < 2;
}

// ============================================================
//  RESUME
// ============================================================
function getResume() { try { return localStorage.getItem(RESUME_KEY) || ''; } catch { return ''; } }
function setResume(t) { try { localStorage.setItem(RESUME_KEY, t); } catch {} refreshResumeButton(); }
function clearResume() { try { localStorage.removeItem(RESUME_KEY); } catch {} refreshResumeButton(); }
function refreshResumeButton() {
  const has = !!getResume();
  resumeBtn.classList.toggle('loaded', has);
  resumeBtnLabel.textContent = has ? 'Resume loaded' : 'Add resume';
  clearResumeBtn.hidden = !has;
  sortMatchTab.disabled = !has;
  sortMatchTab.title = has ? 'Sort by match score' : 'Upload resume to enable';
}

// Resume modal
function openModal() { modalScrim.hidden = false; modalStatus.hidden = true; refreshResumeButton(); }
function closeModal() { modalScrim.hidden = true; }
function showStatus(msg, kind = 'loading') {
  modalStatus.hidden = false; modalStatus.className = `modal-status ${kind}`; modalStatus.textContent = msg;
}
resumeBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalScrim.addEventListener('click', e => { if (e.target === modalScrim) closeModal(); });
browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
uploader.addEventListener('click', () => fileInput.click());
clearResumeBtn.addEventListener('click', () => { clearResume(); showStatus('Resume cleared.', 'ok'); });
['dragenter','dragover'].forEach(ev => uploader.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); uploader.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev => uploader.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); uploader.classList.remove('dragover'); }));
uploader.addEventListener('drop', e => { const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); });
fileInput.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) uploadFile(f); fileInput.value = ''; });

async function uploadFile(file) {
  if (file.size > 5*1024*1024) return showStatus('Max 5 MB.', 'err');
  showStatus(`Parsing ${file.name}…`);
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/resume/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setResume(d.text);
    showStatus(`Saved — ${d.chars.toLocaleString()} chars extracted.`, 'ok');
  } catch (err) { showStatus(`Failed: ${err.message}`, 'err'); }
}

// ============================================================
//  SKILL CHIPS (free, from JSearch/Apify highlights)
// ============================================================
function deriveCardSkills(job) {
  const quals = (job.highlights?.Qualifications) || [];
  if (!quals.length) return [];
  const short = quals.filter(q => { const w = (q||'').trim().split(/\s+/).length; return w > 0 && w <= 5; });
  const extras = [];
  for (const q of quals) {
    if (short.length + extras.length >= 6) break;
    if ((q||'').split(/\s+/).length > 5) {
      for (const p of q.split(/[,/]|(?:\band\b)/i).map(s => s.trim()).filter(s => s && s.split(/\s+/).length <= 4)) {
        if (short.length + extras.length >= 6) break;
        if (!short.includes(p) && !extras.includes(p)) extras.push(p);
      }
    }
  }
  return [...short, ...extras].slice(0, 6);
}

// ============================================================
//  SORT
// ============================================================
function setActiveSort(sortBy) {
  state.currentSort = sortBy;
  document.querySelectorAll('.sort-tab').forEach(t => t.classList.toggle('active', t.dataset.sort === sortBy));
  applySortAndRender();
}

function applySortAndRender() {
  let jobs = [...state.jobsList];
  if (state.currentSort === 'date') {
    jobs.sort((a, b) => (b.posted_ts || 0) - (a.posted_ts || 0));
  } else if (state.currentSort === 'match') {
    jobs.sort((a, b) => (state.batchScores[b.id] || 0) - (state.batchScores[a.id] || 0));
  }
  renderJobs(jobs);
}

sortTabs.addEventListener('click', async e => {
  const tab = e.target.closest('.sort-tab');
  if (!tab || tab.disabled) return;
  const sortBy = tab.dataset.sort;

  if (sortBy === 'match' && Object.keys(state.batchScores).length === 0) {
    // Need to batch-score first
    tab.textContent = 'Scoring…';
    tab.disabled = true;
    await runBatchScore();
    tab.textContent = 'Match';
    tab.disabled = false;
  }
  setActiveSort(sortBy);
});

async function runBatchScore() {
  const resume = getResume();
  if (!resume) return;
  const top15 = state.jobsList.slice(0, 15);
  if (!top15.length) return;
  try {
    const r = await fetch('/api/batch-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume,
        jobs: top15.map(j => ({ title: j.title, employer: j.employer, description: j.description })),
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    const scores = d.scores || {};
    top15.forEach((job, i) => {
      if (scores[String(i)] !== undefined) state.batchScores[job.id] = scores[String(i)];
    });
  } catch (err) { console.warn('Batch score failed:', err.message); }
}

// ============================================================
//  RENDERING
// ============================================================
function skeletonCard() {
  const el = document.createElement('div'); el.className = 'skeleton';
  el.innerHTML = `<div class="sk-head"><div class="sk-row sk-logo"></div><div class="sk-head-text"><div class="sk-row sk-sm"></div><div class="sk-row sk-md"></div></div></div><div class="sk-row sk-lg"></div><div class="sk-row sk-lg" style="width:60%"></div><div class="sk-tags"><div class="sk-row sk-tag"></div><div class="sk-row sk-tag"></div><div class="sk-row sk-tag"></div></div>`;
  return el;
}
function showSkeletons(n = 6) { grid.innerHTML = ''; for (let i = 0; i < n; i++) grid.appendChild(skeletonCard()); }

function renderJobs(jobs) {
  grid.innerHTML = '';
  state.jobsById = {};
  if (!jobs.length) {
    grid.innerHTML = `<div class="empty">Nothing matched — yet.<span class="empty-sub">Try broader keywords, a different location, or experience level.</span></div>`;
    return;
  }
  jobs.forEach((job, i) => {
    state.jobsById[job.id] = job;
    const card = document.createElement('article'); card.className = 'card'; card.style.animationDelay = `${i*40}ms`;
    const logo = job.employer_logo
      ? `<img src="${job.employer_logo}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${initials(job.employer)}'}))" />`
      : initials(job.employer);
    const skills = deriveCardSkills(job);
    const scoreVal = state.batchScores[job.id];
    const scoreBadge = scoreVal !== undefined ? `<span class="tag tag-score ${scoreVal >= 75 ? 'tag-good' : scoreVal >= 50 ? 'tag-warn' : 'tag-bad'}">${scoreVal}%</span>` : '';

    card.innerHTML = `
      <div class="card-head"><div class="card-logo">${logo}</div><div>
        <p class="card-employer">${esc(job.employer || 'Unknown')}</p>
        <h3 class="card-title">${esc(job.title || 'Untitled')}</h3>
      </div></div>
      <div class="card-meta">
        ${scoreBadge}
        ${job.is_remote ? `<span class="tag tag-accent">Remote</span>` : ''}
        <span class="tag">${esc(locStr(job))}</span>
        <span class="tag">${esc((job.employment_type||'FULLTIME').replace('_',' ').toLowerCase())}</span>
      </div>
      ${skills.length ? `<div class="skill-chips">${skills.map(s => `<span class="skill-chip">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="card-footer"><span>${fmtRel(job.posted_ts)}</span><span class="open-arrow">View →</span></div>
    `;
    card.addEventListener('click', () => openPanel(job.id));
    grid.appendChild(card);
  });
}

// ============================================================
//  PANEL
// ============================================================
function openPanel(id) {
  const job = state.jobsById[id]; if (!job) return;
  const hasResume = !!getResume();
  const logo = job.employer_logo ? `<img src="${job.employer_logo}" alt="" style="width:52px;height:52px;border-radius:12px;object-fit:cover;margin-bottom:20px;" />` : '';
  const quals = (job.highlights?.Qualifications || []).slice(0,8);
  const resps = (job.highlights?.Responsibilities || []).slice(0,8);
  const bens = (job.highlights?.Benefits || []).slice(0,8);
  const sal = (job.salary_min || job.salary_max)
    ? `${job.salary_currency||''} ${job.salary_min||'—'} – ${job.salary_max||'—'} ${job.salary_period ? '/ '+job.salary_period.toLowerCase() : ''}`
    : null;

  panelInner.innerHTML = `
    ${logo}
    <p class="panel-employer">${esc(job.employer||'')}</p>
    <h2 class="panel-title">${esc(job.title||'')}</h2>
    <div class="panel-meta">
      ${job.is_remote ? `<span class="tag tag-accent">Remote</span>` : ''}
      <span class="tag">${esc(locStr(job))}</span>
      <span class="tag">${esc((job.employment_type||'FULLTIME').replace('_',' ').toLowerCase())}</span>
      ${sal ? `<span class="tag tag-accent">${esc(sal)}</span>` : ''}
      <span class="tag">${fmtRel(job.posted_ts)}</span>
    </div>
    <div class="llm-section">
      <div class="llm-actions">
        <button class="llm-btn" id="extractBtn"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Extract skills</button>
        <button class="llm-btn" id="matchBtn" ${hasResume?'':'disabled'} title="${hasResume?'':'Add resume first'}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Analyze match</button>
        <button class="llm-btn" id="rewriteBtn" ${hasResume?'':'disabled'} title="${hasResume?'':'Add resume first'}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10l1.5-4L9 1l2 2-5.5 5.5L2 10z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Rewrite for this role</button>
      </div>
      ${!hasResume ? `<div class="llm-note">Add your resume to enable match analysis and rewriting.</div>` : ''}
      <div id="llmResult"></div>
    </div>
    ${quals.length ? `<div class="panel-section"><h4>Qualifications</h4><ul>${quals.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    ${resps.length ? `<div class="panel-section"><h4>Responsibilities</h4><ul>${resps.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    ${bens.length ? `<div class="panel-section"><h4>Benefits</h4><ul>${bens.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    ${job.description ? `<div class="panel-section"><h4>About the role</h4><div class="panel-desc">${esc(job.description.slice(0,2000))}${job.description.length>2000?'…':''}</div></div>` : ''}
    ${job.apply_link ? `<a class="apply-btn" href="${job.apply_link}" target="_blank" rel="noopener">Apply on ${esc(job.publisher||'source')} <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 11L11 3M5 3h6v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>` : ''}
  `;
  document.getElementById('extractBtn').addEventListener('click', () => runExtract(job));
  const mb = document.getElementById('matchBtn');
  if (mb && !mb.disabled) mb.addEventListener('click', () => runMatch(job));
  const rb = document.getElementById('rewriteBtn');
  if (rb && !rb.disabled) rb.addEventListener('click', () => runRewrite(job));
  panel.classList.add('open'); panelScrim.classList.add('open'); panel.setAttribute('aria-hidden','false');
}

function closePanel() { panel.classList.remove('open'); panelScrim.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }
panelClose.addEventListener('click', closePanel);
panelScrim.addEventListener('click', closePanel);
document.addEventListener('keydown', e => { if (e.key==='Escape') { if (!modalScrim.hidden) closeModal(); else closePanel(); } });

// ---- LLM: extract ----
async function runExtract(job) {
  const btn = document.getElementById('extractBtn'), out = document.getElementById('llmResult'), orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Extracting…`; out.innerHTML = '';
  try {
    const r = await fetch('/api/extract', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({description: job.description||''}) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    out.innerHTML = `<div class="extract-result">
      ${(d.required||[]).length ? `<div class="extract-group"><div class="extract-group-label">Required</div><div class="extract-chips">${d.required.map(s=>`<span class="extract-chip required">${esc(s)}</span>`).join('')}</div></div>` : ''}
      ${(d.nice_to_have||[]).length ? `<div class="extract-group"><div class="extract-group-label">Nice to have</div><div class="extract-chips">${d.nice_to_have.map(s=>`<span class="extract-chip">${esc(s)}</span>`).join('')}</div></div>` : ''}
    </div>`;
  } catch (err) { out.innerHTML = `<div class="llm-error">Failed: ${esc(err.message)}</div>`; }
  finally { btn.disabled = false; btn.innerHTML = orig; }
}

// ---- LLM: match ----
async function runMatch(job) {
  const btn = document.getElementById('matchBtn'), out = document.getElementById('llmResult'), orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Analyzing…`; out.innerHTML = '';
  try {
    const r = await fetch('/api/match', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ resume: getResume(), description: job.description||'', title: job.title||'' }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    const sc = Number(d.score)||0, cls = sc>=75?'good':sc>=50?'warn':'bad', circ = 2*Math.PI*42, dash = (sc/100)*circ;
    out.innerHTML = `<div class="match-result">
      <div class="match-score-wrap"><div class="match-score ${cls}">
        <svg viewBox="0 0 96 96"><circle class="track" cx="48" cy="48" r="42" stroke-width="6" fill="none"/><circle class="bar" cx="48" cy="48" r="42" stroke-width="6" fill="none" stroke-dasharray="${circ}" stroke-dashoffset="${circ-dash}"/></svg>
        <div class="match-score-num"><span class="num">${sc}</span><span class="total">/ 100</span></div>
      </div><div class="match-verdict">${esc(d.verdict||'')}</div></div>
      ${d.reasoning?`<div class="match-reasoning">${esc(d.reasoning)}</div>`:''}
      <div class="match-lists">
        <div class="match-list"><div class="match-list-label good">Matched</div><ul>${(d.matched||[]).map(s=>`<li>${esc(s)}</li>`).join('')||'<li style="color:var(--ink-3)">—</li>'}</ul></div>
        <div class="match-list"><div class="match-list-label bad">Missing</div><ul>${(d.missing||[]).map(s=>`<li>${esc(s)}</li>`).join('')||'<li style="color:var(--ink-3)">—</li>'}</ul></div>
      </div></div>`;
  } catch (err) { out.innerHTML = `<div class="llm-error">Failed: ${esc(err.message)}</div>`; }
  finally { btn.disabled = false; btn.innerHTML = orig; }
}

// ---- LLM: rewrite ----
async function runRewrite(job) {
  const btn = document.getElementById('rewriteBtn'), out = document.getElementById('llmResult'), orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Rewriting…`; out.innerHTML = '';
  try {
    const r = await fetch('/api/rewrite', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ resume: getResume(), description: job.description||'', title: job.title||'' }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    out.innerHTML = `<div class="rewrite-result">
      <div class="rewrite-header"><h4>Rewritten for: ${esc(job.title)}</h4>
        <button class="copy-btn" id="copyRewrite"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M8 4V2a1 1 0 00-1-1H2a1 1 0 00-1 1v5a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.3"/></svg> Copy</button>
      </div>
      <pre class="rewrite-text">${esc(d.rewritten||'')}</pre>
    </div>`;
    document.getElementById('copyRewrite')?.addEventListener('click', () => {
      navigator.clipboard.writeText(d.rewritten || '').then(() => {
        const cb = document.getElementById('copyRewrite');
        if (cb) { cb.textContent = 'Copied!'; setTimeout(() => { cb.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M8 4V2a1 1 0 00-1-1H2a1 1 0 00-1 1v5a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.3"/></svg> Copy`; }, 2000); }
      });
    });
  } catch (err) { out.innerHTML = `<div class="llm-error">Failed: ${esc(err.message)}</div>`; }
  finally { btn.disabled = false; btn.innerHTML = orig; }
}

// ============================================================
//  SEARCH
// ============================================================
async function runSearch() {
  errorBox.hidden = true;
  searchBtn.disabled = true;
  meta.hidden = false; pagination.hidden = true;
  resultCount.textContent = '…'; resultCtx.textContent = 'searching';
  pageNumEl.textContent = state.page;
  state.batchScores = {};

  const ck = cacheKey(state.lastQuery, state.lastExp, state.lastLoc, state.page);

  // Check cache — if 2x already used today, return cached silently
  if (!canFetchFresh(ck)) {
    const cached = getCachedResult(ck);
    if (cached?.data) {
      handleSearchResult(cached.data);
      searchBtn.disabled = false;
      return;
    }
  }

  showSkeletons(6);
  setTimeout(() => {
    if (searchBtn.disabled && resultCtx.textContent === 'searching') {
      resultCtx.textContent = 'scraping LinkedIn\u2026 ~30s';
    }
  }, 5000);

  try {
    const r = await fetch('/api/search', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: state.lastQuery, experience: state.lastExp, location: state.lastLoc, page: state.page }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    saveCacheResult(ck, data);
    handleSearchResult(data);
  } catch (err) {
    grid.innerHTML = ''; meta.hidden = true;
    errorBox.hidden = false; errorBox.textContent = `Something went wrong — ${err.message}`;
  } finally { searchBtn.disabled = false; }
}

function handleSearchResult(data) {
  state.jobsList = data.jobs || [];
  state.hasResults = state.jobsList.length > 0;

  // Determine default sort
  const hasResume = !!getResume();
  state.currentSort = hasResume ? 'match' : 'relevance';
  document.querySelectorAll('.sort-tab').forEach(t => t.classList.toggle('active', t.dataset.sort === state.currentSort));
  sortMatchTab.disabled = !hasResume;

  // If default is match and have resume, auto-batch-score
  if (state.currentSort === 'match' && hasResume && state.jobsList.length > 0) {
    // Score async then re-render
    renderJobs(state.jobsList); // render immediately with relevance order
    resultCount.textContent = String(data.count || 0);
    const src = data.source === 'linkedin' ? 'from LinkedIn' : data.source === 'jsearch' ? 'from JSearch' : '';
    resultCtx.textContent = `${data.count===1?'match':'matches'} ${src}`;
    runBatchScore().then(() => applySortAndRender());
  } else {
    renderJobs(state.jobsList);
    resultCount.textContent = String(data.count || 0);
    const src = data.source === 'linkedin' ? 'from LinkedIn' : data.source === 'jsearch' ? 'from JSearch' : '';
    resultCtx.textContent = `${data.count===1?'match':'matches'} ${src}`;
  }

  const expandedEl = document.getElementById('expandedQuery');
  if (data.expanded_query && data.expanded_query.toLowerCase() !== state.lastQuery.toLowerCase() && state.lastQuery) {
    expandedEl.textContent = '\u21b3 searched as: "' + data.expanded_query + '"';
    expandedEl.hidden = false;
  } else { expandedEl.hidden = true; }

  pagination.hidden = false;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = !state.hasResults;
}

// ---- events ----
form.addEventListener('submit', e => {
  e.preventDefault();
  state.lastQuery = queryEl.value.trim();
  state.lastExp = expEl.value;
  state.lastLoc = locEl.value;
  state.page = 1;
  runSearch();
});
prevBtn.addEventListener('click', () => { if (state.page > 1) { state.page--; runSearch(); window.scrollTo({top:0,behavior:'smooth'}); } });
nextBtn.addEventListener('click', () => { state.page++; runSearch(); window.scrollTo({top:0,behavior:'smooth'}); });

// init
refreshResumeButton();
