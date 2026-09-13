// Live job search, provider-abstracted:
// - Arbeitnow: free, no key, works out of the box — global/remote-leaning.
// - Adzuna: free tier, explicitly covers South Africa (and many other
//   countries) — activates once ADZUNA_APP_ID/ADZUNA_APP_KEY are set
//   (free signup at https://developer.adzuna.com/). Preferred when present.
//
// Neither is "Indeed" — Indeed has no free public API for a deployed server
// to call (their old Publisher API was deprecated). We don't badge results
// as Indeed since we're not on their feed.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|mdash|ndash|hellip);/g, (_, name) => NAMED_ENTITIES[name]);
}

// Some sources (e.g. Arbeitnow) double-encode: the "tags" are literally the
// text "&lt;p&gt;" rather than real <p> markup, so entities must be decoded
// BEFORE stripping — decoding first turns them into real tags, which the
// second pass then strips. Running it twice catches both single- and
// double-encoded input without needing to know which one we got.
function stripHtml(html) {
  let text = String(html || '');
  text = decodeEntities(text);
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text); // in case stripping revealed another layer of entities
  return text.replace(/\s+/g, ' ').trim();
}

async function searchArbeitnow({ q, location }) {
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api?page=1');
  const json = await res.json();
  const needle = (q || '').toLowerCase();
  const locNeedle = (location || '').toLowerCase();
  const jobs = (json.data || [])
    .filter(j => !needle || j.title.toLowerCase().includes(needle) || (j.tags || []).some(t => t.toLowerCase().includes(needle)))
    .filter(j => !locNeedle || (j.location || '').toLowerCase().includes(locNeedle) || (locNeedle === 'remote' && j.remote))
    .slice(0, 30)
    .map(j => ({
      id: j.slug,
      title: j.title,
      company: j.company_name,
      location: j.location || (j.remote ? 'Remote' : ''),
      remote: !!j.remote,
      description: stripHtml(j.description),
      url: j.url,
      postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
    }));
  return { source: 'Arbeitnow', jobs };
}

async function searchAdzuna({ q, location }) {
  const country = process.env.ADZUNA_COUNTRY || 'za';
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID,
    app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: '30',
    what: q || '',
    where: location || '',
    'content-type': 'application/json',
  });
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`);
  if (!res.ok) throw new Error(`Adzuna ${res.status}`);
  const json = await res.json();
  const jobs = (json.results || []).map(j => ({
    id: String(j.id),
    title: j.title,
    company: j.company?.display_name || 'Unknown company',
    location: j.location?.display_name || '',
    remote: false,
    description: stripHtml(j.description),
    url: j.redirect_url,
    postedAt: j.created || null,
    salary: j.salary_min ? `${Math.round(j.salary_min)} - ${Math.round(j.salary_max || j.salary_min)}` : null,
  }));
  return { source: `Adzuna (${country.toUpperCase()})`, jobs };
}

const adzunaConfigured = () => !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);

async function searchJobs(params) {
  if (adzunaConfigured()) {
    try { return await searchAdzuna(params); }
    catch (e) { console.error('[jobs] Adzuna failed, falling back to Arbeitnow:', e.message); }
  }
  return searchArbeitnow(params);
}

module.exports = { searchJobs, adzunaConfigured };
