/* Lumen frontend logic
   - Job search (JSearch via backend proxy)
   - Resume: upload once, store plaintext in localStorage, reuse across sessions
   - Skill chips on cards: from JSearch job_highlights (no LLM)
   - Detail panel: on-demand LLM "Extract skills" and "Analyze match"
*/

const RESUME_KEY = 'lumen.resume.v1';

// ---- DOM refs ----
const form        = document.getElementById('searchForm');
const queryEl     = document.getElementById('query');
const expEl       = document.getElementById('experience');
const searchBtn   = document.getElementById('searchBtn');
const grid        = document.getElementById('grid');
const meta        = document.getElementById('resultsMeta');
const resultCount = document.getElementById('resultCount');
const resultCtx   = document.getElementById('resultContext');
const pageNumEl   = document.getElementById('pageNum');
const errorBox    = document.getElementById('errorBox');
const pagination  = document.getElementById('pagination');
const prevBtn     = document.getElementById('prevBtn');
const nextBtn     = document.getElementById('nextBtn');
const panel       = document.getElementById('panel');
const panelInner  = document.getElementById('panelInner');
const panelClose  = document.getElementById('panelClose');
const panelScrim  = document.getElementById('panelScrim');

const resumeBtn       = document.getElementById('resumeBtn');
const resumeBtnLabel  = document.getElementById('resumeBtnLabel');
const modalScrim      = document.getElementById('modalScrim');
const modalClose      = document.getElementById('modalClose');
const uploader        = document.getElementById('uploader');
const browseBtn       = document.getElementById('browseBtn');
const fileInput       = document.getElementById('fileInput');
const modalStatus     = document.getElementById('modalStatus');
const clearResumeBtn  = document.getElementById('clearResumeBtn');

let state = {
  page: 1,
  lastQuery: '',
  lastExp: '',
  jobsById: {},
  hasResults: false,
};

// ---- helpers ----
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function fmtRelative(ts) {
  if (!ts) return '';
  const diff = Date.now()/1000 - ts;
  if (diff < 3600) return `${Math.max(1, Math.round(diff/60))}m ago`;
  if (diff < 86400) return `${Math.round(diff/3600)}h ago`;
  return `${Math.round(diff/86400)}d ago`;
}
function locationString(j) {
  const parts = [j.city, j.state].filter(Boolean);
  return parts.join(', ') || 'Bangalore';
}
function initials(name) {
  if (!name) return '·';
  return name.split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
}

/* ============================================================
   Skill chips from JSearch Qualifications (no LLM required)
   ============================================================ */
function deriveCardSkills(job) {
  const quals = (job.highlights && job.highlights.Qualifications) || [];
  if (!quals.length) return [];

  // Very lightweight heuristic: surface short qualifications (<= 5 words)
  // as chips. Long ones are sentences, not skills — skip them.
  const short = quals.filter(q => {
    const wc = (q || '').trim().split(/\s+/).length;
    return wc > 0 && wc <= 5;
  });

  // If too few short ones, tokenise the first couple of longer qualifications
  // on commas and slashes — JSearch often lists "X, Y, Z" on one line.
  const extras = [];
  for (const q of quals) {
    if (short.length + extras.length >= 6) break;
    if ((q || '').split(/\s+/).length > 5) {
      const parts = q.split(/[,/]|(?:\band\b)/i)
        .map(s => s.trim())
        .filter(s => s && s.split(/\s+/).length <= 4 && s.length < 40);
      for (const p of parts) {
        if (short.length + extras.length >= 6) break;
        if (!short.includes(p) && !extras.includes(p)) extras.push(p);
      }
    }
  }
  return [...short, ...extras].slice(0, 6);
}

/* ============================================================
   Resume storage (localStorage)
   ============================================================ */
function getResume() {
  try { return localStorage.getItem(RESUME_KEY) || ''; }
  catch { return ''; }
}
function setResume(text) {
  try { localStorage.setItem(RESUME_KEY, text); } catch {}
  refreshResumeButton();
}
function clearResume() {
  try { localStorage.removeItem(RESUME_KEY); } catch {}
  refreshResumeButton();
}
function refreshResumeButton() {
  const has = !!getResume();
  resumeBtn.classList.toggle('loaded', has);
  resumeBtnLabel.textContent = has ? 'Resume loaded' : 'Add resume';
  clearResumeBtn.hidden = !has;
}

/* ============================================================
   Resume modal
   ============================================================ */
function openResumeModal() {
  modalScrim.hidden = false;
  modalStatus.hidden = true;
  modalStatus.textContent = '';
  refreshResumeButton();
}
function closeResumeModal() {
  modalScrim.hidden = true;
}
function showModalStatus(msg, kind = 'loading') {
  modalStatus.hidden = false;
  modalStatus.className = `modal-status ${kind}`;
  modalStatus.textContent = msg;
}
resumeBtn.addEventListener('click', openResumeModal);
modalClose.addEventListener('click', closeResumeModal);
modalScrim.addEventListener('click', e => { if (e.target === modalScrim) closeResumeModal(); });
browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
uploader.addEventListener('click', () => fileInput.click());
clearResumeBtn.addEventListener('click', () => {
  clearResume();
  showModalStatus('Resume cleared.', 'ok');
});

['dragenter','dragover'].forEach(ev =>
  uploader.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    uploader.classList.add('dragover');
  })
);
['dragleave','drop'].forEach(ev =>
  uploader.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    uploader.classList.remove('dragover');
  })
);
uploader.addEventListener('drop', e => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) uploadFile(f);
});
fileInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) uploadFile(f);
  fileInput.value = '';
});

async function uploadFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    return showModalStatus('File too large (max 5 MB).', 'err');
  }
  showModalStatus(`Parsing ${file.name}…`, 'loading');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/resume/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setResume(data.text);
    showModalStatus(`Saved — ${data.chars.toLocaleString()} characters extracted.`, 'ok');
  } catch (err) {
    showModalStatus(`Upload failed: ${err.message}`, 'err');
  }
}

/* ============================================================
   Skeleton + rendering
   ============================================================ */
function skeletonCard() {
  const el = document.createElement('div');
  el.className = 'skeleton';
  el.innerHTML = `
    <div class="sk-head">
      <div class="sk-row sk-logo"></div>
      <div class="sk-head-text">
        <div class="sk-row sk-sm"></div>
        <div class="sk-row sk-md"></div>
      </div>
    </div>
    <div class="sk-row sk-lg"></div>
    <div class="sk-row sk-lg" style="width:60%"></div>
    <div class="sk-tags">
      <div class="sk-row sk-tag"></div>
      <div class="sk-row sk-tag"></div>
      <div class="sk-row sk-tag"></div>
    </div>
  `;
  return el;
}
function showSkeletons(count = 6) {
  grid.innerHTML = '';
  for (let i = 0; i < count; i++) grid.appendChild(skeletonCard());
}

function renderJobs(jobs) {
  grid.innerHTML = '';
  state.jobsById = {};

  if (!jobs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      Nothing matched — yet.
      <span class="empty-sub">Try broader keywords, or a different experience level.</span>
    `;
    grid.appendChild(empty);
    return;
  }

  jobs.forEach((job, i) => {
    state.jobsById[job.id] = job;
    const card = document.createElement('article');
    card.className = 'card';
    card.style.animationDelay = `${i * 40}ms`;
    card.dataset.id = job.id;

    const logo = job.employer_logo
      ? `<img src="${job.employer_logo}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${initials(job.employer)}'}))" />`
      : initials(job.employer);

    const skills = deriveCardSkills(job);
    const skillsHtml = skills.length
      ? `<div class="skill-chips">
           ${skills.map(s => `<span class="skill-chip">${escapeHtml(s)}</span>`).join('')}
         </div>`
      : '';

    card.innerHTML = `
      <div class="card-head">
        <div class="card-logo">${logo}</div>
        <div>
          <p class="card-employer">${escapeHtml(job.employer || 'Unknown')}</p>
          <h3 class="card-title">${escapeHtml(job.title || 'Untitled role')}</h3>
        </div>
      </div>
      <div class="card-meta">
        ${job.is_remote ? `<span class="tag tag-accent">Remote</span>` : ''}
        <span class="tag">${escapeHtml(locationString(job))}</span>
        <span class="tag">${escapeHtml((job.employment_type || 'FULLTIME').replace('_',' ').toLowerCase())}</span>
      </div>
      ${skillsHtml}
      <div class="card-footer">
        <span>${fmtRelative(job.posted_ts)}</span>
        <span class="open-arrow">View →</span>
      </div>
    `;
    card.addEventListener('click', () => openPanel(job.id));
    grid.appendChild(card);
  });
}

/* ============================================================
   Panel: detail view + LLM actions
   ============================================================ */
function openPanel(id) {
  const job = state.jobsById[id];
  if (!job) return;

  const logo = job.employer_logo
    ? `<img src="${job.employer_logo}" alt="" style="width:52px;height:52px;border-radius:12px;object-fit:cover;margin-bottom:20px;" />`
    : '';

  const qualifications  = (job.highlights.Qualifications  || []).slice(0, 8);
  const responsibilities = (job.highlights.Responsibilities || []).slice(0, 8);
  const benefits        = (job.highlights.Benefits || []).slice(0, 8);

  const salary = (job.salary_min || job.salary_max)
    ? `${job.salary_currency || ''} ${job.salary_min || '—'} – ${job.salary_max || '—'} ${job.salary_period ? '/ ' + job.salary_period.toLowerCase() : ''}`
    : null;

  const hasResume = !!getResume();

  panelInner.innerHTML = `
    ${logo}
    <p class="panel-employer">${escapeHtml(job.employer || '')}</p>
    <h2 class="panel-title">${escapeHtml(job.title || '')}</h2>
    <div class="panel-meta">
      ${job.is_remote ? `<span class="tag tag-accent">Remote</span>` : ''}
      <span class="tag">${escapeHtml(locationString(job))}</span>
      <span class="tag">${escapeHtml((job.employment_type || 'FULLTIME').replace('_',' ').toLowerCase())}</span>
      ${salary ? `<span class="tag tag-accent">${escapeHtml(salary)}</span>` : ''}
      <span class="tag">${fmtRelative(job.posted_ts)}</span>
    </div>

    <div class="llm-section">
      <div class="llm-actions">
        <button class="llm-btn" id="extractBtn">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Extract skills
        </button>
        <button class="llm-btn" id="matchBtn" ${hasResume ? '' : 'disabled'} title="${hasResume ? '' : 'Add your resume to enable match analysis'}">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Analyze match
        </button>
      </div>
      ${!hasResume ? `<div class="llm-note">Add your resume via the top-right button to enable match analysis.</div>` : ''}
      <div id="llmResult"></div>
    </div>

    ${qualifications.length ? `
      <div class="panel-section">
        <h4>Qualifications</h4>
        <ul>${qualifications.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
      </div>` : ''}

    ${responsibilities.length ? `
      <div class="panel-section">
        <h4>Responsibilities</h4>
        <ul>${responsibilities.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
      </div>` : ''}

    ${benefits.length ? `
      <div class="panel-section">
        <h4>Benefits</h4>
        <ul>${benefits.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
      </div>` : ''}

    ${job.description ? `
      <div class="panel-section">
        <h4>About the role</h4>
        <div class="panel-desc">${escapeHtml(job.description.slice(0, 2000))}${job.description.length > 2000 ? '…' : ''}</div>
      </div>` : ''}

    ${job.apply_link ? `
      <a class="apply-btn" href="${job.apply_link}" target="_blank" rel="noopener">
        Apply on ${escapeHtml(job.publisher || 'source')}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 11L11 3M5 3h6v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>` : ''}
  `;

  // wire up the LLM buttons
  document.getElementById('extractBtn').addEventListener('click', () => runExtract(job));
  const mb = document.getElementById('matchBtn');
  if (mb && !mb.disabled) mb.addEventListener('click', () => runMatch(job));

  panel.classList.add('open');
  panelScrim.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
}

function closePanel() {
  panel.classList.remove('open');
  panelScrim.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}
panelClose.addEventListener('click', closePanel);
panelScrim.addEventListener('click', closePanel);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!modalScrim.hidden) closeResumeModal();
    else closePanel();
  }
});

/* ---- LLM: extract skills ---- */
async function runExtract(job) {
  const btn = document.getElementById('extractBtn');
  const out = document.getElementById('llmResult');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span> Extracting…`;
  out.innerHTML = '';

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: job.description || '' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const required = data.required || [];
    const nice = data.nice_to_have || [];
    out.innerHTML = `
      <div class="extract-result">
        ${required.length ? `
          <div class="extract-group">
            <div class="extract-group-label">Required</div>
            <div class="extract-chips">
              ${required.map(s => `<span class="extract-chip required">${escapeHtml(s)}</span>`).join('')}
            </div>
          </div>` : ''}
        ${nice.length ? `
          <div class="extract-group">
            <div class="extract-group-label">Nice to have</div>
            <div class="extract-chips">
              ${nice.map(s => `<span class="extract-chip">${escapeHtml(s)}</span>`).join('')}
            </div>
          </div>` : ''}
        ${!required.length && !nice.length ? `<div class="llm-note">No distinct skills extracted.</div>` : ''}
      </div>
    `;
  } catch (err) {
    out.innerHTML = `<div class="llm-error">Extract failed: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

/* ---- LLM: match resume vs job ---- */
async function runMatch(job) {
  const btn = document.getElementById('matchBtn');
  const out = document.getElementById('llmResult');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span> Analyzing…`;
  out.innerHTML = '';

  const resume = getResume();
  try {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume,
        description: job.description || '',
        title: job.title || '',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const score = Number(data.score) || 0;
    const scoreClass = score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad';
    const circ = 2 * Math.PI * 42;
    const dash = (score / 100) * circ;

    out.innerHTML = `
      <div class="match-result">
        <div class="match-score-wrap">
          <div class="match-score ${scoreClass}">
            <svg viewBox="0 0 96 96">
              <circle class="track" cx="48" cy="48" r="42" stroke-width="6" fill="none" />
              <circle class="bar" cx="48" cy="48" r="42" stroke-width="6" fill="none"
                      stroke-dasharray="${circ}" stroke-dashoffset="${circ - dash}" />
            </svg>
            <div class="match-score-num">
              <span class="num">${score}</span>
              <span class="total">/ 100</span>
            </div>
          </div>
          <div class="match-verdict">${escapeHtml(data.verdict || '')}</div>
        </div>
        ${data.reasoning ? `<div class="match-reasoning">${escapeHtml(data.reasoning)}</div>` : ''}
        <div class="match-lists">
          <div class="match-list">
            <div class="match-list-label good">Matched</div>
            <ul>
              ${(data.matched || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li style="color:var(--ink-3)">—</li>'}
            </ul>
          </div>
          <div class="match-list">
            <div class="match-list-label bad">Missing / gaps</div>
            <ul>
              ${(data.missing || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li style="color:var(--ink-3)">—</li>'}
            </ul>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    out.innerHTML = `<div class="llm-error">Match failed: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

/* ============================================================
   Search flow
   ============================================================ */
async function runSearch() {
  errorBox.hidden = true;
  errorBox.textContent = '';

  searchBtn.disabled = true;
  meta.hidden = false;
  pagination.hidden = true;
  resultCount.textContent = '…';
  resultCtx.textContent = 'searching';
  pageNumEl.textContent = state.page;

  showSkeletons(6);

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: state.lastQuery,
        experience: state.lastExp,
        page: state.page,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    renderJobs(data.jobs || []);
    resultCount.textContent = String(data.count || 0);
    resultCtx.textContent = data.count === 1 ? 'match' : 'matches';
    state.hasResults = (data.jobs || []).length > 0;

    pagination.hidden = false;
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = !state.hasResults;
  } catch (err) {
    grid.innerHTML = '';
    meta.hidden = true;
    errorBox.hidden = false;
    errorBox.textContent = `Something went wrong — ${err.message}`;
  } finally {
    searchBtn.disabled = false;
  }
}

/* ---- events ---- */
form.addEventListener('submit', e => {
  e.preventDefault();
  state.lastQuery = queryEl.value.trim();
  state.lastExp = expEl.value;
  state.page = 1;
  runSearch();
});
prevBtn.addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    runSearch();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
nextBtn.addEventListener('click', () => {
  state.page += 1;
  runSearch();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// init
refreshResumeButton();
