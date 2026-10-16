import { compareClicks } from './compare-clicks.js';
import { compareContributions } from './compare-contributions.js';

const DAY = 86400000;
export const MOCK_FIELDS = ['source', 'campaign', 'origin', 'path', 'place', 'dest', 'scope'];
const UNKNOWN = '__unknown__';
const sites = ['bio.diainspace.com', 'labs.diainspace.com', 'humans.diainspace.com',
  'everydaypeople.artcollective.live', 'rebelengine.xyz', 'stitchyfriends.xyz',
  'behave.rblnk.xyz', 'fieldguide.mainops.me'];

export function generateMockClicks({ count = 12000, now = Date.now(), seed = 4271 } = {}) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const pick = values => values[Math.floor(random() * values.length)];
  const weightedSite = () => pick([sites[0], sites[0], sites[0], sites[0], sites[1], sites[1], ...sites.slice(2)]);
  return Array.from({ length: count }, (_, index) => {
    const age = random() < 0.5 ? random() * 14 : 14 + random() * 76;
    const origin = weightedSite();
    const source = age < 10 && random() < 0.55 ? 'facebook' : pick([
      'facebook', 'instagram', 'newsletter', 'google', 'duckduckgo', 'reddit',
      'linkedin', 'mastodon', 'discord', null, null,
    ]);
    const campaign = random() < 0.25 || !source ? null :
      source === 'facebook' ? pick(['kling_video', 'bio_refresh', 'bio_refresh', 'playlist_drop']) :
      source === 'newsletter' ? pick(['studio_notes', 'october_roundup', 'art_launch']) :
      pick(['lab_demo', 'art_launch', 'playlist_drop', 'autumn_collection', 'behind_the_scenes', 'site_launch']);
    const place = pick(['header', 'nav', 'nav', 'main', 'section', 'section', 'footer', 'featured', 'article', 'aside', 'unknown']);
    const path = origin === sites[0] ? pick(['/', '/', '/', '/music', '/links']) :
      pick(['/', '/about', '/projects', '/writing', '/experiments/click-lab', '/music']);
    let dest;
    let scope;
    let name;
    const kind = random();
    if (kind < 0.13) {
      dest = `https://${origin}${path}#${pick(['work', 'about', 'contact', 'latest'])}`;
      scope = 'same-page';
      name = pick(['Explore work', 'About', 'Contact', 'Latest updates']);
    } else if (kind < 0.6) {
      const target = pick(sites);
      const destinationPath = pick(['/', '/projects', '/music', '/about', '/writing']);
      dest = `https://${target}${destinationPath}`;
      scope = 'internal';
      name = pick(['Explore Labs', 'Latest project', 'Listen', 'About the work', 'Read more']);
    } else {
      const destination = pick([
        ['https://github.com/diainspace/', 'GitHub'], ['https://open.spotify.com/artist/mock-artist', 'Spotify'],
        ['https://www.youtube.com/@mock-studio', 'YouTube'], ['https://www.instagram.com/mock-studio/', 'Instagram'],
        ['https://example.org/exhibition', 'Exhibition'], ['https://example.net/reading-list', 'Reading list'],
      ]);
      [dest, name] = destination;
      scope = 'external';
    }
    if (random() < 0.06) name = '';
    return {
      id: `mock-${String(index + 1).padStart(5, '0')}`, event: 'click',
      timestamp: new Date(now - Math.floor(age * DAY)).toISOString(),
      source, campaign, entry: null, origin, path, place, dest, name, scope,
      page: { hostname: origin, path }, properties: [],
    };
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function grouped(events, field) {
  const values = new Map();
  for (const event of events) {
    const value = typeof event[field] === 'string' && event[field].trim() ? event[field] : null;
    values.set(value, (values.get(value) || 0) + 1);
  }
  return [...values].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

function matchesSelection(event, { domain = 'all', filters = {} }) {
  return (domain === 'all' || event.origin === domain) && MOCK_FIELDS.every(field => {
    const wanted = filters[field];
    return !wanted || (wanted === UNKNOWN ? !event[field]?.trim() : event[field] === wanted);
  });
}

export function createMockClickReader({ events, historyEvents, coverageStart } = {}) {
  const generated = events === undefined;
  const snapshot = Date.now();
  events ??= generateMockClicks({ now: snapshot });
  historyEvents ??= generated ? generateMockClicks({ count: 8000, now: snapshot - 90 * DAY, seed: 9813 })
    .map(event => ({ ...event, id: `mock-history-${event.id}` })) : [];
  const allEvents = [...events, ...historyEvents].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  coverageStart ??= generated ? snapshot - 180 * DAY : null;
  return {
    async exportClicks(options) {
      return allEvents.filter(event => {
        const time = Date.parse(event.timestamp);
        return time >= options.startAt && time < options.endAt && matchesSelection(event, options);
      });
    },
    async readClicks({ domain = 'all', startAt, endAt, page = 1, pageSize = 25, filters = {} }) {
      const period = allEvents.filter(event => {
        const time = Date.parse(event.timestamp);
        return time >= startAt && time < endAt;
      });
      const base = period.filter(event => domain === 'all' || event.origin === domain);
      const matches = event => matchesSelection(event, { domain, filters });
      const matching = base.filter(matches);
      const selectedEvents = allEvents.filter(matches);
      const trend = compareClicks({ events: selectedEvents, startAt, endAt, coverageStart });
      const contributions = compareContributions({ events: selectedEvents, comparison: trend });
      const breakdowns = Object.fromEntries(MOCK_FIELDS.map(field => [field, grouped(matching, field)]));
      const facets = Object.fromEntries(MOCK_FIELDS.map(field => [field, grouped(base, field)]));
      const start = (page - 1) * pageSize;
      return {
        dataset: 'mock', synthetic: true, generatedCount: allEvents.length, mockSpanDays: generated ? 180 : null, trend, contributions,
        property: { id: null, domain: domain === 'all' ? 'All mock websites' : domain },
        websites: [...new Set(period.map(event => event.origin))].sort(),
        range: { startAt, endAt }, page, pageSize, count: matching.length,
        totalInPeriod: base.length, isCapped: false, hasNextPage: start + pageSize < matching.length,
        filters, facets, breakdowns,
        summary: {
          knownSources: breakdowns.source.filter(row => row.value !== null).length,
          websites: new Set(matching.map(event => event.origin)).size,
        },
        events: matching.slice(start, start + pageSize),
      };
    },
  };
}
