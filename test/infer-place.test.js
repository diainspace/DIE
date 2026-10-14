import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { inferPlace } from '../src/tracker/infer-place.js';

test('a link inside footer navigation has footer placement', () => {
  const dom = new JSDOM(`
    <footer>
      <nav aria-label="Explore">
        <a href="/labs">Labs</a>
      </nav>
    </footer>
  `);

  const link = dom.window.document.querySelector('a');

  assert.equal(inferPlace(link), 'footer');
  dom.window.close();
});


test('explicit placement overrides the surrounding footer', () => {
  const dom = new JSDOM(`
    <footer>
      <a href="/labs" data-analytics-place="featured">Labs</a>
    </footer>
  `);

  const link = dom.window.document.querySelector('a');

  assert.equal(inferPlace(link), 'featured');
  dom.window.close();
});

test('a link without semantic context has unknown placement', () => {
  const dom = new JSDOM('<div><a href="/labs">Labs</a></div>');
  const link = dom.window.document.querySelector('a');

  assert.equal(inferPlace(link), 'unknown');
  dom.window.close();
});