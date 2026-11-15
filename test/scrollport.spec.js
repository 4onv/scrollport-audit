import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const snippet = fileURLToPath(new URL('../dist/scrollport-audit.js', import.meta.url));
const demo = new URL('../dist/scrollport-audit.html', import.meta.url).href;

async function fixture(page, styles, body) {
  await page.setContent(`<!doctype html><style>${styles}</style><body>${body}</body>`);
  await page.addScriptTag({ path: snippet });
}

test('hidden cross-axis overflow captures a zero-range scrollport and clip restores sticky geometry', async ({ page }) => {
  await page.goto(demo);
  await expect(page.locator('#source-label')).toHaveText('div#wrapper');
  await expect(page.locator('#explanation')).toContainText('0 px of vertical scroll range');
  await expect(page.locator('[data-source=true]')).toContainText('hidden / auto');
  await page.getByRole('button', { name: 'Scroll 160 px' }).click();
  await expect(page.locator('#offset')).toHaveText('Outer 160 px · wrapper 0 px');
  const offset = () => page.evaluate(() => {
    const sticky = document.getElementById('sticky');
    const outer = document.getElementById('outer');
    return sticky.getBoundingClientRect().top - outer.getBoundingClientRect().top;
  });
  expect(await offset()).toBeLessThan(-20);

  await page.getByLabel('Wrapper overflow').selectOption('clip');
  await expect(page.locator('#source-label')).toHaveText('div#outer');
  await expect(page.locator('#ancestors')).toContainText('Clip only');
  await page.getByRole('button', { name: 'Scroll 160 px' }).click();
  await expect.poll(offset).toBeCloseTo(1, 0);
});

test('a deliberate inner scroll container has its own range and controls sticky', async ({ page }) => {
  await page.goto(demo);
  await page.getByLabel('Wrapper overflow').selectOption('inner');
  await expect(page.locator('#source-label')).toHaveText('div#wrapper');
  await expect(page.locator('#explanation')).not.toHaveText(/^0 px of vertical/);
  await page.getByRole('button', { name: 'Scroll 160 px' }).click();
  await expect(page.locator('#offset')).toHaveText('Outer 0 px · wrapper 160 px');
  const gap = await page.evaluate(() => document.querySelector('#sticky').getBoundingClientRect().top
    - document.querySelector('#wrapper').getBoundingClientRect().top);
  expect(gap).toBeCloseTo(0);
});

test('CSS view timeline stays pinned with hidden overflow and progresses with clip', async ({ page }) => {
  await page.goto(demo);
  const supported = await page.evaluate(() => CSS.supports('animation-timeline: view()') && CSS.supports('view-timeline-name: --entry'));
  if (!supported) {
    await expect(page.locator('#timeline')).toHaveText('View timelines unavailable');
    return;
  }
  const progress = () => page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.querySelector('.progress i').getAnimations()[0].effect.getComputedTiming().progress;
  });
  const pinned = await progress();
  await page.getByRole('button', { name: 'Scroll 160 px' }).click();
  await expect(page.locator('#offset')).toHaveText('Outer 160 px · wrapper 0 px');
  expect(await progress()).toBe(pinned);
  await page.getByLabel('Wrapper overflow').selectOption('clip');
  await page.getByLabel('Inspect').selectOption('subject');
  await expect(page.locator('#source-label')).toHaveText('div#outer');
  await expect(page.locator('#timeline')).toHaveText(/^Timeline \d+%$/);
  const initial = await progress();
  await page.getByRole('button', { name: 'Scroll 160 px' }).click();
  await expect.poll(progress).not.toBe(initial);
});

test('logical axes use the source writing mode and surface unset sticky insets', async ({ page }) => {
  await fixture(page, 'main { writing-mode: vertical-rl; overflow:auto; width:100px; height:100px } article { width:300px; height:60px } #item { position:sticky; }',
    '<main id="scroller"><article><span id="item">Sample</span></article></main>');
  const block = await page.evaluate(() => ScrollportAudit.audit(document.querySelector('#item')));
  const inline = await page.evaluate(() => ScrollportAudit.audit(document.querySelector('#item'), { axis: 'inline' }));
  expect(block.source.label).toBe('main#scroller');
  expect(block.source.axis).toBe('x');
  expect(block.source.range).toBe(200);
  expect(block.target.insets).toEqual({ left: 'auto', right: 'auto' });
  expect(block.warnings).toContain('sticky-insets-auto');
  expect(inline.source.axis).toBe('y');
  expect(inline.warnings).toContain('no-scroll-range');
});

test('body overflow propagates to the viewport only when root overflow permits it', async ({ page }) => {
  await fixture(page, 'body { overflow-x:hidden } #item { height:1200px }', '<div id="item"></div>');
  const initial = await page.evaluate(() => ScrollportAudit.audit(document.querySelector('#item')));
  expect(initial.source.kind).toBe('viewport');
  expect(initial.source.overflowFrom).toBe('body');
  expect(initial.ancestors[0].kind).toBe('viewport-propagation');
  const changed = await page.evaluate(() => {
    document.documentElement.style.overflowX = 'hidden';
    return ScrollportAudit.audit(document.querySelector('#item'));
  });
  expect(changed.source.label).toBe('body');
  expect(changed.warnings).toContain('no-scroll-range');
});

test('the viewport uses the principal writing mode propagated by body', async ({ page }) => {
  await fixture(page, 'body { writing-mode: vertical-rl }', '<div id="item">Example</div>');
  const result = await page.evaluate(() => ScrollportAudit.audit(document.querySelector('#item')));
  expect(result.source.kind).toBe('viewport');
  expect(result.source.writingMode).toBe('vertical-rl');
  expect(result.source.axis).toBe('x');
});

test('skips display contents and inline boxes and rejects unsupported targets', async ({ page }) => {
  await fixture(page, '#contents { display:contents; overflow:hidden } #inline { display:inline; overflow:hidden }',
    '<div id="contents"><span id="inline"><span id="item">Text</span></span></div><div id="hidden" hidden></div>');
  const result = await page.evaluate(() => ScrollportAudit.audit(document.querySelector('#item')));
  expect(result.ancestors.slice(0, 2).map(row => row.kind)).toEqual(['no-overflow-box', 'no-overflow-box']);
  expect(result.source.kind).toBe('viewport');
  await expect(page.evaluate(() => ScrollportAudit.audit(document.querySelector('#hidden')))).rejects.toThrow(/rendered layout box/);
  await expect(page.evaluate(() => ScrollportAudit.audit(document.createElement('div')))).rejects.toThrow(/connected light-DOM/);
});

test('offline demo supports keyboard controls, narrow screens, and reduced motion', async ({ page }) => {
  const network = [];
  const errors = [];
  page.on('request', req => { if (/^https?:/u.test(req.url())) network.push(req.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto(demo);
  await expect(page.locator('#source-label')).toHaveText('div#wrapper');
  await expect(page.locator('#timeline')).toHaveText('Timeline animation off for reduced motion');
  await page.getByLabel('Wrapper overflow').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Wrapper overflow')).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
});
