export function inferPlace(element) {
  const explicit = element.getAttribute('data-analytics-place')?.trim();
  if (explicit) return explicit;

  const landmark = element.closest('header, footer');
  if (landmark) return landmark.tagName.toLowerCase();

  const region = element.closest('article, aside, nav, form, section, main');
  return region ? region.tagName.toLowerCase() : 'unknown';
}
