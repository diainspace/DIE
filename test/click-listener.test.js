import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installClickTracker } from '../src/tracker/click-listener.js';

test('a click captures markup overrides and URL attribution', t => {
  const dom = new JSDOM(`
    <footer>
      <a href="#result"
         data-analytics-name="Featured Labs"
         data-analytics-place="featured"
         data-analytics-scope="external">
        Override test
      </a>
    </footer>
  `, {
    url: 'https://die.test/test-clicks?source=facebook&campaign=kling_video',
  });

  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
  };

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
  });

  t.after(() => {
    stop();
    Object.assign(globalThis, originals);
    dom.window.close();
  });

  const events = [];
  const stop = installClickTracker({
    domains: ['die.test'],
    onClick: event => events.push(event),
  });
  
  const link = document.querySelector('a');
  const click = new window.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
  });

  link.dispatchEvent(click);

  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Featured Labs');
  assert.equal(events[0].place, 'featured');
  assert.equal(events[0].scope, 'external');
  assert.equal(events[0].source, 'facebook');
  assert.equal(events[0].campaign, 'kling_video');
  assert.equal(events[0].origin, 'die.test');
  assert.equal(events[0].path, '/test-clicks');
  assert.equal(click.defaultPrevented, false);
  assert.equal(link.getAttribute('href'), '#result');
});