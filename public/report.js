(() => {
  const $ = id => document.getElementById(id);
  const fields = ['source', 'campaign', 'origin', 'path', 'place', 'dest', 'scope'];
  const titles = { source: 'Source', campaign: 'Campaign', origin: 'Origin', path: 'Path', place: 'Placement', dest: 'Destination', scope: 'Scope' };
  const plurals = { source: 'sources', campaign: 'campaigns', origin: 'origins', path: 'paths', place: 'placements', dest: 'destinations', scope: 'scopes' };
  let range;
  let exporting = false;
  let lastReport;
  let loading = false;
  let appliedSelection;
  const preferenceKey = 'die.report.subject.v1';
  const selection = () => ({ dataset: $('dataset').value, domain: $('domain').value, period: $('period').value });
  function restoreSelection() {
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey));
      if (!saved || !['mock', 'local'].includes(saved.dataset) ||
          !['7', '30', '90'].includes(saved.period) || typeof saved.domain !== 'string' ||
          saved.domain.length > 253 ||
          !(saved.domain === 'all' && saved.dataset === 'mock' ||
            /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(saved.domain))) return;
      $('dataset').value = saved.dataset;
      $('period').value = saved.period;
      $('domain').replaceChildren(new Option(saved.domain === 'all' ? 'All mock websites' : saved.domain, saved.domain));
    } catch { /* Storage may be blocked, empty, or unavailable. */ }
  }
  function subjectHeading(subject) {
    $('subject-title').textContent = subject.domain === 'all' ? 'All websites' : subject.domain;
    $('subject-context').textContent = `${subject.dataset === 'mock' ? 'Mock data' : 'Local collected data'} · Last ${subject.period} days`;
  }
  function pendingSelection() {
    const current = selection();
    const changed = appliedSelection && ['dataset', 'domain', 'period'].some(key => current[key] !== appliedSelection[key]);
    $('selection-hint').hidden = !changed;
    if (changed) $('selection-hint').textContent = `Selection changed. Apply to view ${current.domain === 'all' ? 'all websites' : current.domain}.`;
  }
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const label = value => typeof value === 'string' && value.trim() ? value : 'Unknown';
  const valueKey = value => value === null ? '__unknown__' : value;
  function clear() { fields.forEach(field => { $(`filter-${field}`).value = ''; }); }
  function populate(select, values, first, selected = '') {
    select.replaceChildren();
    select.append(new Option(first, ''));
    values.forEach(row => select.append(new Option(`${label(row.value)} (${row.count.toLocaleString()})`, valueKey(row.value))));
    if (selected && !values.some(row => valueKey(row.value) === selected)) {
      select.append(new Option(`${selected === '__unknown__' ? 'Unknown' : selected} (no clicks this period)`, selected));
    }
    select.value = selected;
  }
  function chart(id, report, field) {
    const mock = report.dataset === 'mock';
    let groups;
    let total;
    if (mock) {
      groups = report.breakdowns[field];
      total = report.count;
    } else {
      const counts = new Map();
      report.events.forEach(event => {
        const key = event[field] || null;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      groups = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
      total = report.events.length;
    }
    const list = $(id);
    list.replaceChildren();
    const shownGroups = field === 'dest' ? groups.slice(0, 8) : groups;
    shownGroups.forEach(({ value, count }) => {
      const item = document.createElement('li');
      const heading = text(mock ? 'button' : 'div', '', 'bar-label bar-pick');
      if (mock) {
        heading.type = 'button';
        heading.setAttribute('aria-label', `Filter ${titles[field]}: ${label(value)}, ${count} clicks`);
        heading.addEventListener('click', () => {
          $(`filter-${field}`).value = valueKey(value);
          void load(1, true);
        });
      }
      heading.append(text('span', label(value)), text('strong', count.toLocaleString()));
      const meter = document.createElement('meter');
      meter.min = 0; meter.max = Math.max(1, total); meter.value = count;
      meter.setAttribute('aria-label', `${label(value)}: ${count} of ${total} clicks`);
      item.append(heading, meter); list.append(item);
    });
    if (!groups.length) list.append(text('li', 'No clicks to display.', 'muted'));
    if (groups.length > shownGroups.length) list.append(text('li', `Top ${shownGroups.length} of ${groups.length} destinations. Use the destination filter to focus on another.`, 'muted'));
  }
  function renderTrend(trend) {
    $('trend-panel').hidden = !trend;
    if (!trend) return;
    const chart = $('trend-chart'); chart.replaceChildren();
    $('trend-values').replaceChildren();
    if (!trend.current?.length) {
      $('trend-change').textContent = 'Comparison unavailable';
      $('trend-periods').textContent = '';
      $('trend-description').textContent = 'Choose a supported period to compare activity.';
      $('previous-legend').hidden = true;
      return;
    }
    const formatDate = time => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const period = dates => `${formatDate(dates.startAt)} – ${formatDate(dates.endAt)}`;
    let change;
    if (!trend.available) change = 'Not enough earlier history to compare';
    else if (trend.previousCount === 0 && trend.currentCount > 0) change = 'New activity — no clicks in the previous period';
    else if (trend.currentCount === 0 && trend.previousCount === 0) change = 'No clicks in either period';
    else if (trend.difference === 0) change = 'The same number of clicks';
    else change = `${Math.abs(trend.percentChange).toLocaleString(undefined, { maximumFractionDigits: 1 })}% ${trend.difference > 0 ? 'more' : 'fewer'} link clicks`;
    $('trend-change').textContent = change;
    $('trend-periods').textContent = `${trend.currentCount.toLocaleString()} clicks · ${period(trend.currentRange)}` +
      (trend.available ? ` | ${trend.previousCount.toLocaleString()} previously · ${period(trend.previousRange)}` : '');
    $('previous-legend').hidden = !trend.available;
    $('trend-description').textContent = `Same subject and filters in both periods. Each point covers up to 24 hours; the two lines share one scale.` +
      (trend.available ? '' : ' Missing history is not treated as zero activity.');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = (tag, attributes = {}) => {
      const node = document.createElementNS(ns, tag);
      Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
      return node;
    };
    const left = 55, top = 18, width = 815, height = 185;
    const maximum = Math.max(1, ...trend.current.map(point => point.count), ...(trend.previous || []).map(point => point.count));
    const scale = Math.max(2, Math.ceil(maximum / 2) * 2);
    const x = index => left + (index + 0.5) * width / trend.current.length;
    const y = value => top + height - value / scale * height;
    [0, scale / 2, scale].forEach(value => {
      chart.append(svg('line', { x1: left, x2: left + width, y1: y(value), y2: y(value), class: 'trend-grid' }));
      const tick = svg('text', { x: left - 10, y: y(value) + 5, 'text-anchor': 'end', class: 'trend-axis' });
      tick.textContent = String(value); chart.append(tick);
    });
    for (const index of new Set([0, Math.floor((trend.current.length - 1) / 2), trend.current.length - 1])) {
      const tick = svg('text', { x: x(index), y: top + height + 28, 'text-anchor': 'middle', class: 'trend-axis' });
      tick.textContent = formatDate(trend.current[index].startAt); chart.append(tick);
    }
    const draw = (points, previous) => {
      chart.append(svg('path', { class: `trend-line${previous ? ' previous' : ''}`,
        d: points.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.count)}`).join(' ') }));
    };
    if (trend.previous) draw(trend.previous, true);
    draw(trend.current, false);
    const table = document.createElement('table');
    table.append(text('caption', 'Daily click counts for selected and previous periods'));
    const header = document.createElement('tr');
    for (const value of ['Selected date', 'Clicks', 'Previous date', 'Previous clicks']) header.append(text('th', value));
    table.append(header);
    trend.current.forEach((point, index) => {
      const prior = trend.previous?.[index];
      const circle = svg('circle', { cx: x(index), cy: y(point.count), r: 3, class: 'trend-point' });
      const title = svg('title');
      title.textContent = `${formatDate(point.startAt)}: ${point.count} clicks` + (prior ? `; previous ${formatDate(prior.startAt)}: ${prior.count}` : '');
      circle.append(title); chart.append(circle);
      const row = document.createElement('tr');
      for (const value of [formatDate(point.startAt), String(point.count), prior ? formatDate(prior.startAt) : 'Unavailable', prior ? String(prior.count) : 'Unavailable']) row.append(text('td', value));
      table.append(row);
    });
    $('trend-values').append(table);
  }
  function renderContributions(contributions) {
    $('contributions-panel').hidden = !contributions?.available;
    if (!contributions?.available) return;
    const describe = (field, value) => value === null ?
      (field === 'source' ? 'Source not recorded' : field === 'campaign' ? 'No campaign recorded' : 'Destination not recorded') :
      field === 'dest' ? value.replace(/^https?:\/\//, '') : value;
    const largest = contributions.largestSourceChange;
    $('contributions-summary').textContent = largest
      ? `${describe('source', largest.value)}: ${Math.abs(largest.difference).toLocaleString()} ${largest.difference > 0 ? 'more' : 'fewer'} link clicks — the largest source change.`
      : 'Source totals are unchanged. Check individual campaigns and destinations for shifts.';
    const all = Object.values(contributions.groups).flat();
    const scale = Math.max(1, ...all.map(row => Math.abs(row.difference)));
    for (const field of ['source', 'campaign', 'dest']) {
      const target = $(`${field}-changes`); target.replaceChildren();
      const rows = contributions.groups[field];
      for (const gain of [true, false]) {
        const changed = rows.filter(row => gain ? row.difference > 0 : row.difference < 0);
        target.append(text('h4', gain ? 'More clicks' : 'Fewer clicks', 'change-direction'));
        if (!changed.length) {
          target.append(text('p', gain ? 'No increases in this view.' : 'No decreases in this view.', 'muted'));
          continue;
        }
        const list = document.createElement('ul'); list.className = 'change-list';
        changed.slice(0, 3).forEach(row => {
          const item = document.createElement('li'); item.className = gain ? 'change-row gain' : 'change-row loss';
          const button = text('button', describe(field, row.value), 'change-pick'); button.type = 'button';
          button.setAttribute('aria-label', `Focus ${titles[field]}: ${describe(field, row.value)}`);
          button.addEventListener('click', () => {
            const select = $(`filter-${field}`);
            const value = valueKey(row.value);
            if (![...select.options].some(option => option.value === value)) select.append(new Option(describe(field, row.value), value));
            select.value = value;
            void load(1, true);
          });
          const delta = text('strong', `${gain ? '+' : '−'}${Math.abs(row.difference).toLocaleString()}`, 'change-delta');
          const heading = text('div', '', 'change-heading'); heading.append(button, delta);
          const meter = document.createElement('meter'); meter.min = 0; meter.max = scale; meter.value = Math.abs(row.difference);
          meter.setAttribute('aria-label', `${Math.abs(row.difference)} ${gain ? 'more' : 'fewer'} clicks`);
          const comparison = text('p', `${row.currentCount.toLocaleString()} now · ${row.previousCount.toLocaleString()} previously`, 'change-counts');
          const percent = row.status === 'new' ? 'New this period' : row.status === 'gone' ? 'No clicks this period'
            : `${Math.abs(row.percentChange).toLocaleString(undefined, { maximumFractionDigits: 1 })}% ${gain ? 'increase' : 'decrease'}`;
          item.append(heading, meter, comparison, text('p', percent, 'change-percent'));
          list.append(item);
        });
        target.append(list);
        if (changed.length > 3) target.append(text('p', `Showing the 3 largest of ${changed.length} ${gain ? 'increases' : 'decreases'}.`, 'muted'));
      }
    }
  }
  function render(report) {
    const mock = report.dataset === 'mock';
    $('data-badge').textContent = mock ? 'MOCK DATA' : 'Local data';
    $('mock-notice').hidden = !mock;
    if (mock) $('mock-count-note').textContent = `${report.generatedCount.toLocaleString()} synthetic clicks${report.mockSpanDays ? ` across ${report.mockSpanDays} days, including comparison history` : ''}. Real analytics are untouched.`;
    renderTrend(report.trend);
    renderContributions(report.contributions);
    $('filter-fields').disabled = !mock;
    $('filter-help').textContent = mock ? 'Combine any fields, then apply. Chart labels can also filter the view.' : 'Combination filters are available in the mock dataset preview. Local charts describe the loaded page.';
    if (mock) {
      const website = $('domain').value;
      $('domain').replaceChildren(new Option('All mock websites', 'all'), ...report.websites.map(domain => new Option(domain, domain)));
      $('domain').value = website || 'all';
      fields.forEach(field => populate($(`filter-${field}`), report.facets[field], `All ${plurals[field]}`, report.filters[field] || ''));
    }
    const filterCount = Object.keys(report.filters || {}).length;
    $('filter-count').textContent = filterCount ? `${filterCount} applied` : '';
    $('active-filters').replaceChildren();
    for (const [field, value] of Object.entries(report.filters || {})) {
      const chip = text('button', `${titles[field]}: ${value === '__unknown__' ? 'Unknown' : value} ×`, 'chip');
      chip.type = 'button';
      chip.setAttribute('aria-label', `Remove ${titles[field]} filter`);
      chip.addEventListener('click', () => { $(`filter-${field}`).value = ''; void load(1, true); });
      $('active-filters').append(chip);
    }
    $('total').textContent = `${report.isCapped ? 'At least ' : ''}${(mock ? report.totalInPeriod : report.count).toLocaleString()}`;
    $('loaded-label').textContent = mock ? 'Clicks in this view' : 'Clicks charted';
    $('loaded').textContent = String(mock ? report.count : report.events.length);
    $('sources-label').textContent = mock ? 'Sources bringing clicks' : 'Sources charted';
    $('sources-count').textContent = String(mock ? report.summary.knownSources : new Set(report.events.map(e => e.source).filter(v => typeof v === 'string' && v.trim())).size);
    $('website-count').textContent = String(mock ? report.summary.websites : new Set(report.events.map(e => e.origin || e.page?.hostname).filter(Boolean)).size);
    $('scope-note').textContent = mock
      ? `Charts cover all ${report.count.toLocaleString()} mock clicks in this view. Filters let you focus on a specific question. Unknown means no value was recorded.`
      : `Charts describe the ${report.events.length} clicks on this page, not the entire period. Unknown means no value was recorded.`;
    chart('source-chart', report, 'source'); chart('campaign-chart', report, 'campaign'); chart('place-chart', report, 'place'); chart('dest-chart', report, 'dest');
    $('report').hidden = false;
  }
  function controls() {
    $('refresh').disabled = loading; $('clear').disabled = loading;
    for (const id of ['dataset', 'domain', 'period']) $(id).disabled = loading;
    $('export-clicks').disabled = loading || exporting || !lastReport;
  }
  async function load(page = 1, refresh = false) {
    if (loading) return;
    const requestedSelection = refresh || !range ? selection() : appliedSelection;
    if (refresh || !range) {
      const endAt = Date.now();
      range = { dataset: $('dataset').value, domain: $('domain').value,
        startAt: endAt - Number($('period').value) * 86400000, endAt };
      if (range.dataset === 'mock') fields.forEach(field => {
        const value = $(`filter-${field}`).value;
        if (value) range[field] = value;
      });
    }
    loading = true; controls(); $('error').hidden = true;
    $('status').textContent = 'Loading clicks…';
    try {
      const query = new URLSearchParams({ ...range, page: String(page), pageSize: '25' });
      const response = await fetch(`/reports/clicks?${query}`, { cache: 'no-store', credentials: 'same-origin' });
      const report = await response.json();
      if (!response.ok) {
        throw new Error(report.error === 'property_not_found' ? 'This website has no local Umami property yet. Try die.test.'
          : report.error === 'invalid_report_query' ? 'Check the website name and selected filters.'
          : 'Could not load the report. Check that local DIE and Umami are running.');
      }
      render(report); lastReport = report;
      appliedSelection = requestedSelection;
      subjectHeading(appliedSelection);
      pendingSelection();
      try { localStorage.setItem(preferenceKey, JSON.stringify(appliedSelection)); } catch { /* Keep working without storage. */ }
      $('status').textContent = `${report.dataset === 'mock' ? 'Mock · ' : ''}${report.property.domain} · Last updated ${new Date().toLocaleTimeString()} · Manual refresh`;
    } catch (error) {
      $('report').hidden = true; lastReport = undefined;
      $('status').textContent = 'Report unavailable.';
      $('error').textContent = /^(This website|Check the website|Could not load)/.test(error.message) ? error.message : 'Could not load the report. Check that local DIE is running.';
      $('error').hidden = false;
    } finally { loading = false; controls(); }
  }
  async function downloadCsv() {
    if (loading || exporting || !lastReport) return;
    const query = new URLSearchParams({ ...range, format: 'csv' });
    exporting = true; controls(); $('export-status').textContent = 'Preparing CSV…';
    try {
      const response = await fetch(`/reports/clicks?${query}`, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Export failed');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'die-clicks.csv';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('export-status').textContent = 'CSV downloaded for the applied period and filters.';
    } catch {
      $('export-status').textContent = 'Export unavailable. Try a shorter period or refresh the report.';
    } finally { exporting = false; controls(); }
  }
  $('export-clicks').addEventListener('click', () => { void downloadCsv(); });
  $('filters').addEventListener('submit', event => { event.preventDefault(); void load(1, true); });
  $('clear').addEventListener('click', () => { clear(); void load(1, true); });
  $('dataset').addEventListener('change', () => {
    clear();
    $('domain').replaceChildren($('dataset').value === 'mock' ? new Option('All mock websites', 'all') : new Option('die.test', 'die.test'));
    $('filter-fields').disabled = $('dataset').value !== 'mock';
    pendingSelection();
  });
  $('domain').addEventListener('change', () => { clear(); pendingSelection(); });
  $('period').addEventListener('change', pendingSelection);
  restoreSelection();
  subjectHeading(selection());
  void load();
})();
