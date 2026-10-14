import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLink } from '../src/tracker/classify-link.js';

test('a link to another registered VPS domain is internal', () => {
  const result = classifyLink(
    'https://labs.diainspace.com/',
    'https://bio.diainspace.com/',
    ['bio.diainspace.com', 'labs.diainspace.com']
  );

  assert.equal(result, 'internal');
});

test('a link outside the VPS registry is external', () => {
  const result = classifyLink(
    'https://example.org/',
    'https://bio.diainspace.com/',
    ['bio.diainspace.com', 'labs.diainspace.com']
  );

  assert.equal(result, 'external');
});

test('an anchor on the current page is same-page', () => {
  const result = classifyLink(
    '#artwork',
    'https://bio.diainspace.com/',
    ['bio.diainspace.com']
  );

  assert.equal(result, 'same-page');
});

test('a relative link on a registered site is internal', () => {
  const result = classifyLink(
    '/writing',
    'https://bio.diainspace.com/',
    ['bio.diainspace.com']
  );

  assert.equal(result, 'internal');
});