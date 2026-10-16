const COLUMNS = ['dataset', 'id', 'event', 'timestamp', 'origin', 'path', 'source', 'campaign', 'place', 'scope', 'name', 'dest', 'entry'];
const LIMIT = 25000;

function cell(value) {
  let text = value == null ? '' : String(value);
  // CSV quoting alone does not prevent spreadsheet formulas from executing.
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function clicksCsv(events, dataset) {
  const lines = [COLUMNS.map(cell).join(',')];
  for (const event of events) lines.push(COLUMNS.map(key => cell(key === 'dataset' ? dataset : event[key])).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export async function exportClickRows(reader, options) {
  if (reader.exportClicks) {
    const events = await reader.exportClicks(options);
    if (events.length > LIMIT) throw new Error('export_too_large');
    return events;
  }
  const first = await reader.readClicks({ ...options, page: 1, pageSize: 100 });
  if (first.isCapped || first.count > LIMIT) throw new Error('export_too_large');
  if (!Number.isSafeInteger(first.count) || first.count < 0 || !Array.isArray(first.events)) throw new Error('export_incomplete');
  const events = [...first.events];
  for (let page = 2; page <= Math.ceil(first.count / 100); page++) {
    const next = await reader.readClicks({ ...options, page, pageSize: 100 });
    if (next.count !== first.count || next.isCapped || !Array.isArray(next.events)) throw new Error('export_incomplete');
    events.push(...next.events);
  }
  if (events.length !== first.count || new Set(events.map(event => event.id)).size !== events.length) throw new Error('export_incomplete');
  return events;
}
