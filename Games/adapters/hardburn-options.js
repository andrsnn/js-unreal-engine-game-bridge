// Hard Burn in Unreal: a "Lumen lighting" row in the game's Options > Display panel, under Resolution, built the way
// the game builds its own rows (ui/options.js), which switches Lumen mode through window.jsgb.graphics. F9 does the
// same, and the row follows either. The game's files stay as they are.
const graphics = globalThis.jsgb?.graphics;
const HINT = "Turns on Unreal's Lumen lighting, the full-detail ship models and Unreal's effects. It needs a fast graphics card. F9 also switches it.";

function add() {
  if (!graphics?.get().available || document.querySelector('[data-jsgb-lumen]')) return;
  const rows = [...document.querySelectorAll('.menu-option-row')];
  const after = rows.find(r => r.querySelector('small')?.textContent === 'Resolution') ?? rows.find(r => r.querySelector('small')?.textContent === 'Window');
  if (!after) return;
  const row = document.createElement('div');
  row.className = 'menu-option-row opt-wrap';
  row.dataset.jsgbLumen = '';
  const title = document.createElement('small');
  title.className = 'menu-note';
  title.textContent = 'Lumen lighting';
  row.append(title);
  for (const [on, label] of [[false, 'OFF'], [true, 'ON']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.value = String(on);
    b.onclick = () => graphics.set({lumen: on});
    row.append(b);
  }
  const hint = document.createElement('p');
  hint.className = 'menu-note opt-hint';
  hint.dataset.jsgbLumen = '';
  hint.textContent = HINT;
  // The game puts a row's hint right after it; Resolution has one.
  const anchor = after.nextElementSibling?.classList.contains('opt-hint') ? after.nextElementSibling : after;
  anchor.after(row, hint);
  show();
}

function show() {
  const lumen = graphics.get().lumen;
  for (const b of document.querySelectorAll('[data-jsgb-lumen] button')) b.setAttribute('aria-pressed', String(b.dataset.value === String(lumen)));
}

if (graphics) {
  setInterval(add, 250);
  addEventListener('jsgbgraphicschange', show);
}
