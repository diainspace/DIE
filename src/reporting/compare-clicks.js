const DAY = 86400000;

// Equal-length, adjacent, half-open periods. A click on the boundary belongs only to the current period.
export function compareClicks({ events, startAt, endAt, coverageStart = null }) {
  const duration = endAt - startAt;
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 366 * DAY) {
    return { available: false, reason: 'unsupported_range', current: [], previous: null };
  }
  const previousStart = startAt - duration;
  const available = Number.isFinite(coverageStart) && previousStart >= coverageStart && previousStart >= 0;
  const days = Math.ceil(duration / DAY);
  const current = Array.from({ length: days }, (_, index) => ({
    startAt: startAt + index * DAY, endAt: Math.min(endAt, startAt + (index + 1) * DAY), count: 0,
  }));
  const previous = Array.from({ length: days }, (_, index) => ({
    startAt: previousStart + index * DAY, endAt: Math.min(startAt, previousStart + (index + 1) * DAY), count: 0,
  }));
  for (const event of events) {
    const time = Date.parse(event.timestamp);
    if (time >= startAt && time < endAt) current[Math.floor((time - startAt) / DAY)].count++;
    else if (available && time >= previousStart && time < startAt) previous[Math.floor((time - previousStart) / DAY)].count++;
  }
  const currentCount = current.reduce((sum, day) => sum + day.count, 0);
  const previousCount = available ? previous.reduce((sum, day) => sum + day.count, 0) : null;
  const difference = available ? currentCount - previousCount : null;
  const percentChange = !available ? null : previousCount === 0 ? (currentCount === 0 ? 0 : null)
    : Math.round(difference * 1000 / previousCount) / 10;
  return {
    available, reason: available ? null : 'insufficient_history',
    currentRange: { startAt, endAt }, previousRange: { startAt: previousStart, endAt: startAt },
    currentCount, previousCount, difference, percentChange,
    current, previous: available ? previous : null,
  };
}
