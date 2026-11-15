const get = id => document.getElementById(id);
const outer = get('outer');
const wrapper = get('wrapper');
const progress = document.querySelector('.progress i');
const mode = get('mode');

function updateReadings() {
  get('offset').textContent = `Outer ${outer.scrollTop} px · wrapper ${wrapper.scrollTop} px`;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    get('timeline').textContent = 'Timeline animation off for reduced motion';
    return;
  }
  const animation = progress.getAnimations()[0];
  const current = animation?.effect?.getComputedTiming().progress;
  get('timeline').textContent = animation
    ? `Timeline ${current == null ? 'inactive' : Math.round(current * 100) + '%'}`
    : 'View timelines unavailable';
}

let readingPending = false;
function scheduleReadings() {
  if (readingPending) return;
  readingPending = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    readingPending = false;
    updateReadings();
  }));
}

const status = {
  'scroll-container': 'Scroll container',
  'pass-through': 'Passes through',
  'clip': 'Clip only',
  'viewport-propagation': 'Overflow propagated to viewport',
  'no-overflow-box': 'No overflow box',
  'viewport': 'Viewport fallback',
};

function render() {
  const target = get(get('target').value);
  const audit = auditScrollport(target, { axis: get('axis').value });
  const { source, warnings } = audit;
  get('source-label').textContent = source.label;
  get('source').dataset.warning = String(warnings.length > 0);
  const axis = source.axis === 'y' ? 'vertical' : 'horizontal';
  const bits = [`${source.range} px of ${axis} scroll range.`];
  if (warnings.includes('no-scroll-range')) bits.push('This source cannot move along the selected axis.');
  if (warnings.includes('programmatic-scroll-only')) bits.push('Hidden overflow supports programmatic scrolling.');
  if (warnings.includes('sticky-insets-auto')) bits.push('Both sticky insets are auto on this axis.');
  get('explanation').textContent = bits.join(' ');
  get('insets').textContent = `${audit.target.label} · position: ${audit.target.position} · ${Object.entries(audit.target.insets).map(([edge, value]) => `${edge}: ${value}`).join(' · ')}`;
  get('ancestors').replaceChildren(...audit.ancestors.map((row, index) => {
    const tr = document.createElement('tr');
    if (index === source.index) tr.dataset.source = 'true';
    const name = document.createElement('td');
    name.append(row.label);
    const kind = document.createElement('span');
    kind.textContent = status[row.kind];
    name.append(kind);
    const values = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = `${row.overflow.x} / ${row.overflow.y}`;
    values.append(code);
    const range = document.createElement('td');
    range.textContent = row.range === null ? '—' : `${row.range} px ${row.axis}`;
    tr.append(name, values, range);
    return tr;
  }));
  scheduleReadings();
}

function reset() {
  outer.scrollTop = 0;
  wrapper.scrollTop = 0;
}

mode.addEventListener('change', () => {
  wrapper.dataset.mode = mode.value;
  reset();
  render();
});
get('target').addEventListener('change', render);
get('axis').addEventListener('change', render);
get('jump').addEventListener('click', () => {
  const destination = mode.value === 'inner' ? wrapper : outer;
  destination.scrollTop += 160;
});
get('reset').addEventListener('click', () => {
  reset();
  scheduleReadings();
});
for (const element of [outer, wrapper]) element.addEventListener('scroll', scheduleReadings);
window.addEventListener('resize', render);
render();
