export function classifyLink(href, currentUrl, domains) {
  const current = new URL(currentUrl);
  const destination = new URL(href, current);

  if (
    destination.origin === current.origin &&
    destination.pathname === current.pathname &&
    destination.search === current.search &&
    destination.hash
  ) {
    return 'same-page';
  }

  return domains.includes(destination.hostname)
    ? 'internal'
    : 'external';
}
