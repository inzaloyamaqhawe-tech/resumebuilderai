const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
const { createStore, PLANS } = require('./storage');
const { searchJobs, adzunaConfigured } = require('./jobs');
const { extractText, tailorResume, isAiConfigured } = require('./resume');
const { sendMail } = require('./mailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public', { etag: true, lastModified: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-admin-key';
const PAYPAL_HANDLE = process.env.PAYPAL_HANDLE || 'https://paypal.me/IYTechnologies';
const DEMO_MODE = process.env.DEMO_MODE !== 'false'; // no Postgres yet, so demo mode by default per instruction
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const store = createStore();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

app.use(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  req.authEmail = token ? await store.getSessionEmail(token) : null;
  next();
});

// ---- Config ----
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => {
  res.json({ demoMode: DEMO_MODE, plans: PLANS, payPalHandle: PAYPAL_HANDLE, adzunaConfigured: adzunaConfigured(), aiConfigured: isAiConfigured() });
});

// ---- Accounts ----
app.post('/api/auth/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const existing = await store.getSubscriber(email);
  if (existing?.password_hash) return res.status(409).json({ error: 'An account already exists for this email — log in instead.' });

  await store.setPassword(email, hashPassword(password));
  const token = crypto.randomBytes(24).toString('hex');
  await store.createSession(token, email);
  sendMail(email, 'Welcome to ResumeBuilderAI', 'Your account has been created. Search jobs and upload your CV for free — subscribe any time to unlock AI tailoring.');
  res.json({ ok: true, token, email });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const sub = await store.getSubscriber(email);
  if (!sub?.password_hash || !verifyPassword(password, sub.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  await store.createSession(token, email);
  res.json({ ok: true, token, email });
});

app.post('/api/auth/logout', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) await store.deleteSession(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.authEmail) return res.status(401).json({ error: 'Not logged in.' });
  const sub = await store.getSubscriber(req.authEmail);
  const active = store.isActive(sub);
  res.json({
    email: req.authEmail,
    status: sub?.status || 'pending',
    plan: sub?.plan || null,
    expiresAt: sub?.expires_at || null,
    active,
    tailorUsed: sub?.tailorCount || 0,
    tailorLimit: active ? PLANS[sub.plan]?.tailorLimit ?? PLANS.starter.tailorLimit : 0,
  });
});

// ---- Jobs (free, no login required) ----
app.get('/api/jobs', async (req, res) => {
  try {
    const result = await searchJobs({ q: req.query.q, location: req.query.location });
    res.json(result);
  } catch (e) {
    console.error('job search failed', e);
    res.status(500).json({ error: 'Job search failed — try again shortly.' });
  }
});

// ---- Currency conversion (display only — billing stays in ZAR via PayPal) ----
app.get('/api/currency/convert', async (req, res) => {
  const to = String(req.query.to || 'USD').toUpperCase();
  const amount = parseFloat(req.query.amount || '0');
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=ZAR&symbols=${to}`);
    const json = await r.json();
    const rate = json?.rates?.[to];
    if (!rate) return res.status(400).json({ error: 'Unsupported currency' });
    res.json({ from: 'ZAR', to, rate, amount, converted: Math.round(amount * rate * 100) / 100 });
  } catch (e) {
    res.status(502).json({ error: 'Conversion service unavailable' });
  }
});

// ---- Subscriptions ----
app.post('/api/subscribe', async (req, res) => {
  const email = req.authEmail || String(req.body?.email || '').trim().toLowerCase();
  const plan = String(req.body?.plan || 'starter');
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!PLANS[plan]) return res.status(400).json({ error: 'Unknown plan.' });
  await store.upsertPending(email);
  res.json({
    ok: true,
    demoMode: DEMO_MODE,
    payLink: `${PAYPAL_HANDLE}/${PLANS[plan].price}`,
    plan, price: PLANS[plan].price,
    instructions: DEMO_MODE
      ? `Demo mode: no real charge. Click "Simulate Payment" to test the ${PLANS[plan].label} plan.`
      : `Pay R${PLANS[plan].price} via the link, then message us your payment reference with this email (${email}) so we can activate your ${PLANS[plan].label} plan. Activation is manual for now.`,
  });
});

app.post('/api/demo/activate', async (req, res) => {
  if (!DEMO_MODE) return res.status(403).json({ error: 'Demo activation is disabled — real payments are live.' });
  const email = req.authEmail || String(req.body?.email || '').trim().toLowerCase();
  const plan = String(req.body?.plan || 'starter');
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!PLANS[plan]) return res.status(400).json({ error: 'Unknown plan.' });
  await store.activate(email, 30, plan);
  sendMail(email, 'Your ResumeBuilderAI subscription is active (demo)', `Demo activation — no real payment was taken. Your ${PLANS[plan].label} plan is active for 30 days.`);
  res.json({ ok: true });
});

// ---- CV upload → plain text (stateless: client holds the text, no server storage) ----
app.post('/api/cv/upload', upload.single('cv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const text = await extractText(req.file.buffer, req.file.originalname);
    if (!text || text.trim().length < 20) return res.status(422).json({ error: 'Could not read meaningful text from that file.' });
    res.json({ ok: true, text, filename: req.file.originalname });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

// ---- Tailoring (requires an active, non-exhausted plan) ----
app.post('/api/cv/tailor', async (req, res) => {
  const email = req.authEmail || String(req.body?.email || '').trim().toLowerCase();
  const { resumeText, jobDescription } = req.body || {};
  if (!email) return res.status(401).json({ error: 'Log in first.' });
  if (!resumeText || !jobDescription) return res.status(400).json({ error: 'resumeText and jobDescription are required.' });

  const quota = await store.checkAndConsumeTailorQuota(email);
  if (!quota.allowed) {
    return res.status(402).json({
      locked: true,
      reason: quota.reason,
      payLink: `${PAYPAL_HANDLE}/${PLANS.starter.price}`,
      message: quota.reason === 'quota_exceeded'
        ? `You've used all ${quota.limit} tailorings on your current plan this cycle. Upgrade for more.`
        : 'Subscribe to unlock AI-powered CV tailoring.',
    });
  }

  try {
    const result = await tailorResume(resumeText, jobDescription);
    res.json({ ok: true, ...result, quota: { used: quota.used, limit: quota.limit } });
  } catch (e) {
    console.error('tailor failed', e);
    res.status(500).json({ error: 'Tailoring failed — try again shortly.' });
  }
});

// ---- Admin ----
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}
app.get('/api/admin/subscribers', requireAdmin, async (req, res) => {
  res.json({ subscribers: await store.listSubscribers() });
});
app.post('/api/admin/activate', requireAdmin, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const days = Number(req.body?.days || 30);
  const plan = String(req.body?.plan || 'starter');
  if (!email) return res.status(400).json({ error: 'email required' });
  await store.activate(email, days, plan);
  sendMail(email, 'Your ResumeBuilderAI subscription is active', `Thanks for your payment — your ${PLANS[plan]?.label || plan} plan is now active for ${days} days.`);
  res.json({ ok: true });
});
app.post('/api/admin/deactivate', requireAdmin, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });
  await store.deactivate(email);
  res.json({ ok: true });
});
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const subs = await store.listSubscribers();
  const now = new Date();
  const active = subs.filter(s => s.status === 'active' && s.expires_at && new Date(s.expires_at) > now);
  const pending = subs.filter(s => s.status === 'pending');
  const inactiveOrExpired = subs.length - active.length - pending.length;
  const estimatedMRR = active.reduce((sum, s) => sum + (PLANS[s.plan]?.price || 0), 0);
  const byPlan = {};
  active.forEach(s => { byPlan[s.plan] = (byPlan[s.plan] || 0) + 1; });
  res.json({
    demoMode: DEMO_MODE, adzunaConfigured: adzunaConfigured(), aiConfigured: isAiConfigured(),
    users: { total: subs.length, active: active.length, pending: pending.length, inactiveOrExpired },
    revenue: { estimatedMRR, byPlan },
  });
});

store.init().then(() => {
  app.listen(PORT, () => console.log(`resumebuilderai listening on ${PORT}`));
});
