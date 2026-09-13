// ---------- Nav / routing ----------
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.mainnav-item');
function showView(name) {
  views.forEach(v => v.classList.toggle('active', v.dataset.view === name));
  navItems.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  window.location.hash = `/${name}`;
}
navItems.forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
function routeFromHash() {
  const name = (window.location.hash.replace('#/', '') || 'dashboard').trim();
  const valid = [...views].some(v => v.dataset.view === name);
  showView(valid ? name : 'dashboard');
}
window.addEventListener('hashchange', routeFromHash);

// ---------- Auth ----------
let authToken = null;
try { authToken = localStorage.getItem('rba_token'); } catch (e) {}
let currentUser = null;
let currentConfig = null;

function authHeaders() { return authToken ? { Authorization: `Bearer ${authToken}` } : {}; }
function setToken(t) { authToken = t; try { localStorage.setItem('rba_token', t); } catch (e) {} }
function clearToken() { authToken = null; currentUser = null; try { localStorage.removeItem('rba_token'); } catch (e) {} }

async function refreshMe() {
  if (!authToken) { currentUser = null; updateAuthUI(); return; }
  try {
    const res = await fetch('/api/auth/me', { headers: authHeaders() });
    if (!res.ok) clearToken(); else currentUser = await res.json();
  } catch (e) {}
  updateAuthUI();
}

function planLabel(planKey) {
  const p = currentConfig?.plans?.[planKey];
  return p ? `${p.label} (R${p.price}/mo)` : (planKey || '—');
}

function updateAuthUI() {
  const loggedIn = !!currentUser;
  document.getElementById('authLoggedOut').style.display = loggedIn ? 'none' : 'block';
  document.getElementById('authLoggedIn').style.display = loggedIn ? 'block' : 'none';
  document.getElementById('authPill').style.display = loggedIn ? 'inline-block' : 'none';
  document.getElementById('acctLoggedInBox').style.display = loggedIn ? 'block' : 'none';
  document.getElementById('acctLoggedOutBox').style.display = loggedIn ? 'none' : 'block';

  if (loggedIn) {
    document.getElementById('authPill').textContent = currentUser.email;
    document.getElementById('authWhoEmail').textContent = currentUser.email;
    document.getElementById('authStatusNote').textContent = currentUser.active
      ? `${planLabel(currentUser.plan)} active — expires ${new Date(currentUser.expiresAt).toLocaleDateString()}.`
      : 'No active plan yet — search and upload are still free.';
    document.getElementById('acctEmailShown').textContent = currentUser.email;
    document.getElementById('acctPlan').textContent = currentUser.plan ? planLabel(currentUser.plan) : '—';
    document.getElementById('acctStatus').textContent = currentUser.active ? 'Active' : (currentUser.status || 'pending');
    document.getElementById('acctExpires').textContent = currentUser.expiresAt ? new Date(currentUser.expiresAt).toLocaleDateString() : '—';
    document.getElementById('acctTailorUsage').textContent = currentUser.active
      ? `${currentUser.tailorUsed} / ${currentUser.tailorLimit === Infinity || currentUser.tailorLimit == null ? '∞' : currentUser.tailorLimit}`
      : '—';
    tailorEmailInput.value = currentUser.email;
    tailorEmailInput.readOnly = true;
  } else {
    tailorEmailInput.readOnly = false;
  }
}

document.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
  document.getElementById('authSubmitBtn').textContent = tab.dataset.mode === 'signup' ? 'Create free account' : 'Log in';
  document.getElementById('authMsg').textContent = '';
}));

document.getElementById('authSubmitBtn').addEventListener('click', async () => {
  const mode = document.querySelector('.auth-tab.active').dataset.mode;
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const msg = document.getElementById('authMsg');
  if (!email || !password) { msg.textContent = 'Enter both email and password.'; return; }
  try {
    const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || 'Something went wrong.'; return; }
    setToken(data.token); msg.textContent = '';
    await refreshMe();
  } catch (e) { msg.textContent = 'Network error — try again.'; }
});

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }); } catch (e) {}
  clearToken(); updateAuthUI();
}
document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('acctLogoutBtn').addEventListener('click', logout);
document.getElementById('goJobsFromHero').addEventListener('click', () => showView('jobs'));
document.getElementById('acctPricingBtn').addEventListener('click', () => showView('pricing'));
document.getElementById('acctGoHeroBtn').addEventListener('click', () => showView('dashboard'));
document.getElementById('goPricingFromTailor').addEventListener('click', () => showView('pricing'));

// ---------- Config ----------
async function loadConfig() {
  const res = await fetch('/api/config');
  currentConfig = await res.json();
  document.getElementById('demoBanner').style.display = currentConfig.demoMode ? 'block' : 'none';
  document.getElementById('demoPill').style.display = currentConfig.demoMode ? 'inline-block' : 'none';
  document.getElementById('statSource').textContent = currentConfig.adzunaConfigured ? 'Adzuna (ZA)' : 'Arbeitnow';
  document.getElementById('statAiMode').textContent = currentConfig.aiConfigured ? 'Gemini AI' : 'Keyword match';
  document.getElementById('jobSourceNote').textContent = currentConfig.adzunaConfigured
    ? 'Live listings via Adzuna (South Africa).'
    : 'Live listings via Arbeitnow — mostly global/remote roles until an Adzuna key is added for full South African coverage.';
  renderPlans();
}

// ---------- Jobs ----------
const jobResults = document.getElementById('jobResults');
let lastJobs = [];

async function searchJobs() {
  const q = document.getElementById('jobQuery').value.trim();
  const location = document.getElementById('jobLocation').value.trim();
  jobResults.innerHTML = '<p class="note">Searching…</p>';
  try {
    const res = await fetch(`/api/jobs?q=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}`);
    const data = await res.json();
    lastJobs = data.jobs || [];
    if (!lastJobs.length) { jobResults.innerHTML = '<p class="note">No matching jobs found — try a broader search.</p>'; return; }
    jobResults.innerHTML = lastJobs.map((j, i) => `
      <div class="job-card" data-idx="${i}">
        <div class="jc-top">
          <div><div class="jc-title">${j.title}</div><div class="jc-company">${j.company}</div></div>
          <div class="jc-loc">${j.location}${j.remote ? ' · Remote' : ''}</div>
        </div>
        <div class="jc-snippet">${j.description.slice(0, 220)}…</div>
      </div>
    `).join('');
    jobResults.querySelectorAll('.job-card').forEach(el => el.addEventListener('click', () => openJobModal(lastJobs[Number(el.dataset.idx)])));
  } catch (e) {
    jobResults.innerHTML = '<p class="note">Search failed — try again shortly.</p>';
  }
}
document.getElementById('jobSearchBtn').addEventListener('click', searchJobs);

const jobModal = document.getElementById('jobModal');
let selectedJob = null;
function openJobModal(job) {
  selectedJob = job;
  document.getElementById('jobModalTitle').textContent = job.title;
  document.getElementById('jobModalSub').textContent = `${job.company} · ${job.location}`;
  document.getElementById('jobModalBody').textContent = job.description;
  document.getElementById('jobApplyLink').href = job.url;
  jobModal.classList.add('open');
}
document.getElementById('jobModalClose').addEventListener('click', () => jobModal.classList.remove('open'));
jobModal.addEventListener('click', (e) => { if (e.target === jobModal) jobModal.classList.remove('open'); });
document.getElementById('jobTailorBtn').addEventListener('click', () => {
  if (selectedJob) document.getElementById('jobDescInput').value = selectedJob.description;
  jobModal.classList.remove('open');
  showView('tailor');
});

// ---------- CV upload ----------
const dropzone = document.getElementById('dropzone');
const cvFile = document.getElementById('cvFile');
const cvFilename = document.getElementById('cvFilename');
let uploadedResumeText = null;

dropzone.addEventListener('click', () => cvFile.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault(); dropzone.classList.remove('drag');
  if (e.dataTransfer.files.length) handleCvFile(e.dataTransfer.files[0]);
});
cvFile.addEventListener('change', () => { if (cvFile.files.length) handleCvFile(cvFile.files[0]); });

async function handleCvFile(file) {
  cvFilename.textContent = `Uploading ${file.name}…`;
  const fd = new FormData();
  fd.append('cv', file);
  try {
    const res = await fetch('/api/cv/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { cvFilename.textContent = data.error || 'Upload failed.'; return; }
    uploadedResumeText = data.text;
    cvFilename.textContent = `✓ ${data.filename} — ${data.text.length.toLocaleString()} characters extracted`;
  } catch (e) {
    cvFilename.textContent = 'Upload failed — try again.';
  }
}

// ---------- Tailoring ----------
const tailorEmailInput = document.getElementById('tailorEmail');
const tailorMsg = document.getElementById('tailorMsg');
const tailorLockedBox = document.getElementById('tailorLockedBox');
const tailorResultBox = document.getElementById('tailorResult');

document.getElementById('tailorBtn').addEventListener('click', async () => {
  const email = currentUser?.email || tailorEmailInput.value.trim();
  const jobDescription = document.getElementById('jobDescInput').value.trim();
  tailorLockedBox.style.display = 'none';
  tailorResultBox.style.display = 'none';
  if (!email) { tailorMsg.textContent = 'Log in or create an account first (Home tab).'; return; }
  if (!uploadedResumeText) { tailorMsg.textContent = 'Upload your CV first.'; return; }
  if (!jobDescription) { tailorMsg.textContent = 'Paste a job description, or send one in from Find Jobs.'; return; }

  tailorMsg.textContent = 'Tailoring…';
  try {
    const res = await fetch('/api/cv/tailor', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ email, resumeText: uploadedResumeText, jobDescription }),
    });
    const data = await res.json();
    if (res.status === 402) {
      tailorMsg.textContent = '';
      document.getElementById('tailorLockedText').textContent = data.message;
      tailorLockedBox.style.display = 'block';
      return;
    }
    if (!res.ok) { tailorMsg.textContent = data.error || 'Something went wrong.'; return; }
    tailorMsg.textContent = '';
    renderTailorResult(data);
    if (currentUser) refreshMe();
  } catch (e) {
    tailorMsg.textContent = 'Network error — try again.';
  }
});

function renderTailorResult(data) {
  tailorResultBox.style.display = 'block';
  const score = data.matchScore;
  const scoreColor = score >= 70 ? '#2fd480' : score >= 40 ? '#f2b84b' : '#ff5d6c';
  const modeLabel = data.mode === 'ai' ? 'AI-tailored' : 'Keyword match report';
  tailorResultBox.innerHTML = `
    <div class="row" style="justify-content:space-between;">
      <h2 style="margin:0;">Result</h2>
      <span class="ai-mode-pill ${data.mode}">${modeLabel}</span>
    </div>
    <div class="match-score">
      <div class="match-score-ring" style="background:${scoreColor}22; color:${scoreColor}; border:3px solid ${scoreColor};">${score != null ? score : '—'}</div>
      <div class="match-score-label">Match score${data.quota ? ` · ${data.quota.used}/${data.quota.limit == null ? '∞' : data.quota.limit} tailorings used this cycle` : ''}</div>
    </div>
    ${data.matched?.length ? `<div class="note" style="margin-top:0;">Keywords you already cover:</div><div class="chip-list">${data.matched.map(m => `<span class="chip have">${m}</span>`).join('')}</div>` : ''}
    ${data.missing?.length ? `<div class="note">Keywords the job mentions that your CV doesn't:</div><div class="chip-list">${data.missing.map(m => `<span class="chip missing">${m}</span>`).join('')}</div>` : ''}
    ${data.suggestions?.length ? `<div class="note"><strong>Suggestions:</strong><ul>${data.suggestions.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
    ${data.tailoredText ? `
      <div class="note"><strong>AI-tailored resume:</strong></div>
      <div class="tailored-output">${data.tailoredText}</div>
      <div class="row" style="margin-top:10px;"><button class="secondary" id="downloadTailoredBtn">Download as .txt</button></div>
    ` : ''}
  `;
  const dl = document.getElementById('downloadTailoredBtn');
  if (dl) dl.addEventListener('click', () => {
    const blob = new Blob([data.tailoredText], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'tailored-resume.txt'; a.click();
  });
}

// ---------- Pricing / currency ----------
let currentCurrency = 'ZAR';
async function convertPrice(amountZar, to) {
  if (to === 'ZAR') return { converted: amountZar, symbol: 'R' };
  try {
    const res = await fetch(`/api/currency/convert?amount=${amountZar}&to=${to}`);
    const data = await res.json();
    return { converted: data.converted, symbol: to };
  } catch (e) { return null; }
}
const CURRENCY_SYMBOL = { ZAR: 'R', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', NGN: '₦', KES: 'KSh', INR: '₹' };

async function renderPlans() {
  if (!currentConfig?.plans) return;
  const grid = document.getElementById('plansGrid');
  const entries = Object.entries(currentConfig.plans);
  grid.innerHTML = entries.map(([key, p], i) => `
    <div class="plan-card ${i === 1 ? 'featured' : ''}">
      <div class="plan-name">${p.label}</div>
      <div class="plan-price">R${p.price} <span>/ month</span></div>
      <div class="plan-price-alt" id="altPrice-${key}"></div>
      <ul class="plan-list">
        <li>${p.tailorLimit == null ? 'Unlimited AI tailorings' : p.tailorLimit + ' AI tailorings / month'}</li>
        <li>Unlimited free job search</li>
        <li>CV upload &amp; keyword match report</li>
      </ul>
      <div class="row">
        <input type="email" id="planEmail-${key}" placeholder="you@example.com" />
      </div>
      <div class="row" style="margin-top:10px;">
        <button data-plan="${key}" class="get-access-btn">Get Access</button>
        <button data-plan="${key}" class="secondary demo-btn" style="display:none;">🧪 Simulate</button>
      </div>
    </div>
  `).join('');

  if (currentConfig.demoMode) grid.querySelectorAll('.demo-btn').forEach(b => b.style.display = 'inline-block');
  if (currentUser) entries.forEach(([key]) => { const el = document.getElementById(`planEmail-${key}`); if (el) { el.value = currentUser.email; el.readOnly = true; } });

  grid.querySelectorAll('.get-access-btn').forEach(btn => btn.addEventListener('click', () => subscribe(btn.dataset.plan)));
  grid.querySelectorAll('.demo-btn').forEach(btn => btn.addEventListener('click', () => demoActivate(btn.dataset.plan)));

  updateCurrencyDisplay();
}

async function updateCurrencyDisplay() {
  if (!currentConfig?.plans) return;
  for (const [key, p] of Object.entries(currentConfig.plans)) {
    const el = document.getElementById(`altPrice-${key}`);
    if (!el) continue;
    if (currentCurrency === 'ZAR') { el.textContent = ''; continue; }
    el.textContent = 'converting…';
    const r = await convertPrice(p.price, currentCurrency);
    el.textContent = r ? `≈ ${CURRENCY_SYMBOL[currentCurrency] || currentCurrency}${r.converted} ${currentCurrency}` : '';
  }
}
document.getElementById('currencySelect').addEventListener('change', (e) => { currentCurrency = e.target.value; updateCurrencyDisplay(); });

async function subscribe(plan) {
  const emailEl = document.getElementById(`planEmail-${plan}`);
  const email = currentUser?.email || emailEl.value.trim();
  const out = document.getElementById('subResult');
  if (!email) { out.textContent = 'Enter your email first.'; return; }
  try {
    const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, plan }) });
    const data = await res.json();
    if (!res.ok) { out.textContent = data.error || 'Something went wrong.'; return; }
    out.innerHTML = `${data.instructions}${data.demoMode ? '' : `<br><br><a href="${data.payLink}" target="_blank" rel="noopener">👉 Pay R${data.price} via PayPal</a>`}`;
  } catch (e) { out.textContent = 'Network error — try again.'; }
}
async function demoActivate(plan) {
  const emailEl = document.getElementById(`planEmail-${plan}`);
  const email = currentUser?.email || emailEl.value.trim();
  const out = document.getElementById('subResult');
  if (!email) { out.textContent = 'Enter your email first.'; return; }
  try {
    const res = await fetch('/api/demo/activate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, plan }) });
    const data = await res.json();
    if (!res.ok) { out.textContent = data.error || 'Something went wrong.'; return; }
    out.textContent = `Simulated payment successful for ${email} on the ${plan} plan. Go to CV Tailor to try it.`;
    if (currentUser) await refreshMe();
  } catch (e) { out.textContent = 'Network error — try again.'; }
}

// ---------- Boot ----------
loadConfig();
refreshMe();
routeFromHash();
