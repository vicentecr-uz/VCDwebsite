import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

const SITE = 'https://vicentecr.uz';
const NAME = 'Vicente Cruz';
const CLAIMED_ON = '2026-11-25';
const STAGNANT_WEEKS = 12;
const REFERRAL_DAYS = 180;
const historyPath = process.argv[2] ?? 'history.json';
const reportPath = process.argv[3] ?? 'report.md';

const layout = readFileSync('src/layouts/Layout.astro', 'utf8');
const profileUrl = layout.match(/DIRECTORY_PROFILE_URL = '([^']+)'/)?.[1];

const problems = [];
const concerns = [];
const facts = [];

async function get(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    return { status: res.status, url: res.url, headers: res.headers, text: await res.text() };
  } catch (error) {
    return { status: 0, url, headers: new Headers(), text: '', error: String(error) };
  }
}

async function referrals(host) {
  const { UMAMI_URL, UMAMI_USERNAME, UMAMI_PASSWORD, UMAMI_WEBSITE_ID } = process.env;
  if (!UMAMI_URL || !UMAMI_USERNAME || !UMAMI_PASSWORD || !UMAMI_WEBSITE_ID) return null;
  const login = await fetch(`${UMAMI_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: UMAMI_USERNAME, password: UMAMI_PASSWORD }),
  });
  if (!login.ok) throw new Error(`Umami login failed: ${login.status}`);
  const { token } = await login.json();
  const endAt = Date.now();
  const startAt = endAt - REFERRAL_DAYS * 86_400_000;
  const res = await fetch(
    `${UMAMI_URL}/api/websites/${UMAMI_WEBSITE_ID}/metrics?type=referrer&startAt=${startAt}&endAt=${endAt}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Umami metrics failed: ${res.status}`);
  const rows = await res.json();
  return rows.filter((row) => String(row.x).includes(host)).reduce((sum, row) => sum + row.y, 0);
}

let verdict = 'keep';

if (!profileUrl) {
  verdict = 'unclaimed';
  facts.push('No `DIRECTORY_PROFILE_URL` in `src/layouts/Layout.astro`; the claim has been removed, so this check can be deleted too.');
} else {
  const { origin, host, pathname } = new URL(profileUrl);
  const listing = await get(profileUrl);
  const html = listing.text;

  if (listing.status !== 200) problems.push(`Listing returns ${listing.status || listing.error}.`);
  else {
    if (new URL(listing.url).pathname !== pathname) problems.push(`Listing now redirects to ${listing.url}.`);
    if (!html.includes(NAME)) problems.push(`Listing no longer names ${NAME}.`);
    if (!new RegExp(`href="${SITE.replace(/\./g, '\\.')}/?"`).test(html)) problems.push(`Listing no longer links to ${SITE}.`);
    const robots = `${html.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? ''} ${listing.headers.get('x-robots-tag') ?? ''}`;
    if (/noindex/i.test(robots)) problems.push('Listing is now `noindex`, so search engines and agents ignore it.');
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
    if (canonical && canonical.replace(/\/$/, '') !== profileUrl) problems.push(`Listing canonical now points to ${canonical}.`);
  }

  const robotsTxt = await get(`${origin}/robots.txt`);
  if (/^Disallow:\s*\/\s*$/m.test(robotsTxt.text)) problems.push(`${host} now blocks all crawlers in robots.txt.`);

  const sitemap = await get(`${origin}/sitemap.xml`);
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const listings = locs.filter((loc) => new URL(loc).pathname.split('/').filter(Boolean).length === 1).length;
  if (sitemap.status !== 200 || !locs.length) concerns.push(`${host} sitemap is unavailable (${sitemap.status || sitemap.error}).`);
  else {
    facts.push(`Directory sitemap lists ${listings} top-level pages.`);
    if (!locs.some((loc) => loc.replace(/\/$/, '') === profileUrl)) problems.push('Listing has dropped out of the directory sitemap.');
  }

  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : [];
  const today = new Date().toISOString().slice(0, 10);
  if (listings) history.push({ date: today, listings });
  writeFileSync(historyPath, JSON.stringify(history.slice(-104), null, 2));

  const weeksAgo = (weeks) => {
    const cutoff = Date.now() - weeks * 7 * 86_400_000;
    return history.filter((entry) => Date.parse(entry.date) <= cutoff).at(-1);
  };
  const past = weeksAgo(STAGNANT_WEEKS);
  if (past && listings) {
    const change = listings - past.listings;
    facts.push(`${change >= 0 ? '+' : ''}${change} pages since ${past.date}.`);
    if (change < 0) concerns.push(`Directory shrank from ${past.listings} to ${listings} pages in ${STAGNANT_WEEKS} weeks.`);
    else if (change === 0) concerns.push(`Directory has not grown in ${STAGNANT_WEEKS} weeks; it may be abandoned.`);
  } else facts.push(`Trend needs ${STAGNANT_WEEKS} weeks of history (have ${history.length} run${history.length === 1 ? '' : 's'}).`);

  try {
    const visits = await referrals(host);
    if (visits === null) facts.push('Referral traffic not checked: Umami secrets are not set.');
    else {
      facts.push(`${visits} visits referred by ${host} in the last ${REFERRAL_DAYS} days.`);
      const claimedLongEnough = Date.now() - Date.parse(CLAIMED_ON) > REFERRAL_DAYS * 86_400_000;
      if (visits === 0 && claimedLongEnough) concerns.push(`No visits from ${host} in ${REFERRAL_DAYS} days.`);
    }
  } catch (error) {
    facts.push(`Referral traffic not checked: ${error.message}.`);
  }

  verdict = problems.length ? 'remove' : concerns.length ? 'review' : 'keep';
}

const heading = {
  keep: 'Keep the portfolios.here claim',
  review: 'Review the portfolios.here claim',
  remove: 'Remove the portfolios.here claim',
  unclaimed: 'No portfolios.here claim',
}[verdict];
const action = {
  keep: '',
  review: 'The listing is intact but the directory may no longer be worth claiming. Decide whether to keep it.',
  remove: 'The listing no longer represents you. Delete `DIRECTORY_PROFILE_URL` and its `rel="me"` and `sameAs` uses in `src/layouts/Layout.astro`, then delete this check.',
  unclaimed: 'Delete `.github/workflows/directory-profile-check.yml` and `scripts/check-directory-profile.mjs`.',
}[verdict];
const list = (title, items) => (items.length ? `\n### ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}\n` : '');
const report = `## ${heading}\n\n${profileUrl ? `[${profileUrl}](${profileUrl})\n\n` : ''}${action}\n${list('Broken', problems)}${list('Signs of decline', concerns)}${list('Signals', facts)}`;

writeFileSync(reportPath, report);
console.log(report);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\ntitle=${heading}\n`);
