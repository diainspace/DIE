const FIELDS = ['source', 'campaign', 'dest'];

// These are alternative groupings of the same clicks, not independent causes to add together.
export function compareContributions({ events, comparison }) {
  if (!comparison?.available) return { available: false, groups: {}, largestSourceChange: null };
  const { currentRange, previousRange } = comparison;
  const maps = Object.fromEntries(FIELDS.map(field => [field, new Map()]));
  for (const event of events) {
    const time = Date.parse(event.timestamp);
    const period = time >= currentRange.startAt && time < currentRange.endAt ? 'currentCount'
      : time >= previousRange.startAt && time < previousRange.endAt ? 'previousCount' : null;
    if (!period) continue;
    for (const field of FIELDS) {
      const value = typeof event[field] === 'string' && event[field].trim() ? event[field] : null;
      if (!maps[field].has(value)) maps[field].set(value, { value, currentCount: 0, previousCount: 0 });
      maps[field].get(value)[period]++;
    }
  }
  const groups = Object.fromEntries(FIELDS.map(field => [field,
    [...maps[field].values()].map(row => {
      const difference = row.currentCount - row.previousCount;
      return {
        ...row, difference,
        percentChange: row.previousCount === 0 ? null : Math.round(difference * 1000 / row.previousCount) / 10,
        status: difference === 0 ? 'unchanged' : row.previousCount === 0 ? 'new'
          : row.currentCount === 0 ? 'gone' : difference > 0 ? 'up' : 'down',
      };
    }).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || String(a.value).localeCompare(String(b.value))),
  ]));
  return {
    available: true, groups,
    largestSourceChange: groups.source.find(row => row.difference !== 0) ?? null,
  };
}
