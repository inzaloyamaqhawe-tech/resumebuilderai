// CV text extraction + tailoring.
//
// Tailoring has two modes, chosen automatically:
// - Real AI rewrite via the Gemini API, once GEMINI_API_KEY is set (this is
//   the actual "AI-powered" showcase feature — Gemini is the production
//   model here; Claude is reserved for development of this codebase, not
//   called from the running app).
// - A zero-cost heuristic keyword-gap report as a fallback, so the feature
//   works and is genuinely useful (not a fake demo) before that key exists.
// The UI is told which mode produced a result and labels it honestly either way.

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

async function extractText(buffer, filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  if (lower.endsWith('.txt')) return buffer.toString('utf8');
  throw new Error('Unsupported file type — upload a PDF, DOCX, or TXT.');
}

// A curated skills/keyword list keeps the heuristic from just diffing common
// English words — it looks for things that actually signal a requirement.
const SKILL_HINTS = [
  'javascript', 'typescript', 'python', 'java', 'react', 'node', 'sql', 'excel',
  'communication', 'leadership', 'project management', 'customer service',
  'sales', 'marketing', 'accounting', 'bookkeeping', 'data analysis', 'aws',
  'azure', 'docker', 'kubernetes', 'agile', 'scrum', 'crm', 'erp', 'sap',
  'photoshop', 'figma', 'html', 'css', 'c++', 'c#', 'linux', 'devops',
  'machine learning', 'financial modeling', 'negotiation', 'recruitment',
  'logistics', 'supply chain', 'teamwork', 'problem solving', 'driver\'s license',
];

// Common sentence-starters that would otherwise get mistaken for a proper
// noun/tool name just because they're capitalized at the start of a sentence.
const STOPWORDS = new Set([
  'looking', 'we', 'you', 'your', 'the', 'a', 'an', 'our', 'this', 'that',
  'about', 'job', 'role', 'position', 'company', 'candidate', 'applicant',
  'please', 'must', 'should', 'will', 'apply', 'join', 'if', 'as', 'in',
]);

function extractKeywords(text) {
  const lower = text.toLowerCase();
  const found = new Set();
  for (const skill of SKILL_HINTS) if (lower.includes(skill)) found.add(skill);
  // Also grab capitalized multi-word phrases (likely tools/certifications) from the ORIGINAL-case text.
  const properNouns = text.match(/\b[A-Z][a-zA-Z0-9+.#]{2,}(?:\s[A-Z][a-zA-Z0-9+.#]{2,}){0,2}\b/g) || [];
  properNouns.forEach(p => {
    const lowerP = p.toLowerCase();
    if (p.length < 30 && !STOPWORDS.has(lowerP)) found.add(lowerP);
  });
  return found;
}

function heuristicTailor(resumeText, jobDescription) {
  const jobKeywords = extractKeywords(jobDescription);
  const resumeKeywords = extractKeywords(resumeText);
  const matched = [...jobKeywords].filter(k => resumeKeywords.has(k));
  const missing = [...jobKeywords].filter(k => !resumeKeywords.has(k));
  const matchScore = jobKeywords.size ? Math.round((matched.length / jobKeywords.size) * 100) : null;

  return {
    mode: 'heuristic',
    matchScore,
    matched: matched.slice(0, 20),
    missing: missing.slice(0, 20),
    suggestions: [
      missing.length ? `Consider adding evidence of: ${missing.slice(0, 8).join(', ')} — only if genuinely true of your experience.` : 'Your resume already covers the keywords this job description emphasizes.',
      'Mirror the job posting\'s exact terminology where your experience genuinely matches it — many employers scan for specific phrases.',
      'Lead bullet points with outcomes and numbers (e.g. "reduced X by 20%") rather than just listing duties.',
    ],
    tailoredText: null, // heuristic mode doesn't rewrite the document itself
  };
}

async function aiTailor(resumeText, jobDescription) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const prompt = `You are a professional resume writer. Given the candidate's current resume and a target job description, produce:
1. A concise match assessment (0-100 score + 2-3 sentence rationale).
2. A rewritten version of the resume, tailored to this job — keep it truthful to the candidate's actual experience (never invent employers, dates, or skills they didn't mention), but reorder, re-emphasize, and rephrase to align with the job's language and priorities.

Return ONLY valid JSON with this exact shape, no markdown fences, no commentary:
{"matchScore": <0-100 integer>, "rationale": "<string>", "tailoredResume": "<full rewritten resume as plain text>"}

RESUME:
"""${resumeText.slice(0, 12000)}"""

JOB DESCRIPTION:
"""${jobDescription.slice(0, 6000)}"""`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = JSON.parse(raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, ''));
  return {
    mode: 'ai',
    matchScore: parsed.matchScore,
    matched: [], missing: [],
    suggestions: [parsed.rationale],
    tailoredText: parsed.tailoredResume,
  };
}

async function tailorResume(resumeText, jobDescription) {
  if (process.env.GEMINI_API_KEY) {
    try { return await aiTailor(resumeText, jobDescription); }
    catch (e) {
      console.error('[resume] AI tailor failed, falling back to heuristic:', e.message);
      return heuristicTailor(resumeText, jobDescription);
    }
  }
  return heuristicTailor(resumeText, jobDescription);
}

module.exports = { extractText, tailorResume, isAiConfigured: () => !!process.env.GEMINI_API_KEY };
