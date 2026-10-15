import { classifyLink } from './classify-link.js';
import { inferPlace } from './infer-place.js';

function inferLinkName(link) {
  return link.getAttribute('data-analytics-name')?.trim() ||
    link.getAttribute('aria-label')?.trim() ||
    link.textContent.trim() ||
    [...link.querySelectorAll('img[alt]')]
      .map(image => image.getAttribute('alt').trim()).filter(Boolean).join(' ') ||
    link.getAttribute('title')?.trim() || '';
}

export function installClickTracker({ domains, onClick = console.log }) {
  function handleClick(event) {
    if (!(event.target instanceof Element)) return;

    const link = event.target.closest('a[href]');
    if (!link) return;

    const page = new URL(window.location.href);
    let destination;

    try {
      destination = new URL(link.getAttribute('href'), page);
    } catch {
      return;
    }

    if (!['http:', 'https:'].includes(destination.protocol)) return;

    const declaredScope = link.getAttribute('data-analytics-scope')?.trim();
    const scope = ['internal', 'external', 'same-page'].includes(declaredScope)? declaredScope : classifyLink(destination.href, page.href, domains);

    onClick({
      event: 'click',
      origin: page.hostname,
      path: page.pathname,
      dest: destination.href,
      name: inferLinkName(link),
      scope,
      place: inferPlace(link),
      source: page.searchParams.get('source') || page.searchParams.get('utm_source') || null,
      campaign: page.searchParams.get('campaign') || page.searchParams.get('utm_campaign') || null,
      url: page.href,
    });
  }

  document.addEventListener('click', handleClick);
  return () => document.removeEventListener('click', handleClick);
}
