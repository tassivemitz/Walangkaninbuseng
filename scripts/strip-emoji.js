const fs = require('fs');
const path = require('path');

const svg = (inner) =>
  `<span class="ui-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg></span>`;

const I = {
  arrow: svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
  check: svg('<path d="m20 6-11 11L4 12"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.3L21 8"/><path d="M21 3v5h-5"/>'),
  bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
  alert: svg('<path d="M12 9v4"/><path d="M12 17h.01"/><path d="m10.3 4.3-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-2.7l-8-14a2 2 0 0 0-3.4 0z"/>'),
  receipt: svg('<path d="M6 2h12v20l-2-1.5L14 22l-2-1.5L10 22l-2-1.5L6 22z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>'),
  user: svg('<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  clip: svg('<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>'),
  trend: svg('<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
  gift: svg('<rect x="3" y="8" width="18" height="4"/><path d="M12 8v13"/><path d="M5 12v8h14v-8"/><path d="M12 8c-2-3-5-3-5 0s5 0 5 0 5 0 5 0-3-3-5 0z"/>'),
  coins: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  cash: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 10v.01"/><path d="M18 14v.01"/>'),
  swap: svg('<path d="m7 7 10 0"/><path d="m14 4 3 3-3 3"/><path d="M17 17H7"/><path d="m10 14-3 3 3 3"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>'),
  heart: svg('<path d="M19 14c1.5-1.5 2-3.5 1-5s-3-2-4 0l-4 4-4-4c-1-2-3-1.5-4 0s-.5 3.5 1 5l7 7z"/>'),
  checkCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  scale: svg('<path d="M12 3v18"/><path d="M3 7h18"/><path d="m5 7 3 7H2z"/><path d="m19 7 3 7h-6z"/>'),
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  home: svg('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 15 9-9"/><path d="m16 6 3 3"/><path d="m18 8 2 2"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  star: svg('<path d="m12 3 2.7 5.5L21 9.2l-4.5 4.4L17.5 20 12 17l-5.5 3 1-6.4L3 9.2l6.3-.7z"/>'),
  stop: svg('<circle cx="12" cy="12" r="9"/><path d="m5 5 14 14"/>'),
  gem: svg('<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/><path d="m12 21 4-12"/><path d="m12 21-4-12"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3"/>'),
  pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/>'),
  tree: svg('<path d="M12 22v-6"/><path d="M7 16h10l-2-4h3L12 3 6 12h3z"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  tag: svg('<path d="M20 13 11 4H4v7l9 9z"/><circle cx="7.5" cy="7.5" r="1"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>'),
  arrowNe: svg('<path d="M7 17 17 7"/><path d="M8 7h9v9"/>'),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="m5 5 14 14"/>'),
  inbox: svg('<path d="M3 13h5l2 3h4l2-3h5"/><path d="M4 13 6 4h12l2 9v6H4z"/>'),
  bank: svg('<path d="M3 10h18"/><path d="m12 3 9 7H3z"/><path d="M5 10v8"/><path d="M10 10v8"/><path d="M14 10v8"/><path d="M19 10v8"/><path d="M3 18h18"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>'),
  card: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
  chevR: svg('<path d="m9 6 6 6-6 6"/>'),
  chevL: svg('<path d="m15 6-6 6 6 6"/>'),
  spark: svg('<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m18.4 5.6-2.8 2.8"/><path d="m8.4 15.6-2.8 2.8"/>'),
  box: svg('<path d="M21 8 12 3 3 8l9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
  bulb: svg('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8 14a5 5 0 1 1 8 0c-.8.8-1.2 1.6-1.4 2.5H9.4C9.2 15.6 8.8 14.8 8 14z"/>'),
  up: svg('<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>'),
  shield: svg('<path d="M12 3 5 6v6c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6z"/>'),
  party: svg('<path d="M4 20 14 10"/><path d="m9 6 1 2"/><path d="m14 4 1 2"/><path d="m18 8 2 1"/><path d="M14 10 20 4"/><path d="m4 20 6-2 8-8-4-4L6 14z"/>'),
};

const map = {
  '➔': I.arrow,
  '➜': I.arrow,
  '➤': I.arrow,
  '➥': I.arrow,
  '✓': I.check,
  '✔': I.check,
  '✅': I.checkCircle,
  '✕': I.x,
  '✖': I.x,
  '✗': I.x,
  '✘': I.x,
  '🔁': I.refresh,
  '🔄': I.refresh,
  '⚡': I.bolt,
  '⚠': I.alert,
  '🧾': I.receipt,
  '👤': I.user,
  '👥': I.users,
  '📋': I.clip,
  '📈': I.trend,
  '🎁': I.gift,
  '💰': I.coins,
  '💸': I.cash,
  '⇄': I.swap,
  '🎯': I.target,
  '💛': I.heart,
  '⚖': I.scale,
  '📲': I.phone,
  '🏠': I.home,
  '🔑': I.key,
  '🔍': I.search,
  '★': I.star,
  '⭐': I.star,
  '🌟': I.star,
  '⛔': I.stop,
  '💎': I.gem,
  '📷': I.camera,
  '✎': I.pencil,
  '🗑': I.trash,
  '🌳': I.tree,
  '🔒': I.lock,
  '🔐': I.lock,
  '🏷': I.tag,
  '💬': I.chat,
  '↗': I.arrowNe,
  '🚫': I.ban,
  '📥': I.inbox,
  '🏦': I.bank,
  '🌐': I.globe,
  '💳': I.card,
  '👉': I.chevR,
  '👈': I.chevL,
  '✦': I.spark,
  '✨': I.spark,
  '📦': I.box,
  '💡': I.bulb,
  '⬆': I.up,
  '🛡': I.shield,
  '🎉': I.party,
};

const keys = Object.keys(map).sort((a, b) => b.length - a.length);

function convert(text) {
  let t = text.replace(/\uFE0F/g, '');
  for (const k of keys) t = t.split(k).join(map[k]);
  t = t.replace(/\.textContent(\s*=\s*[^;\n]*ui-ico[^;\n]*)/g, '.innerHTML$1');
  return t;
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'scripts') continue;
      walk(p);
      continue;
    }
    if (!/\.(html|js)$/.test(name)) continue;
    const before = fs.readFileSync(p, 'utf8');
    const after = convert(before);
    if (after !== before) {
      fs.writeFileSync(p, after);
      console.log('updated', p);
    }
  }
}

walk(path.join(__dirname, '..', 'public'));
