const fs = require('fs');
const path = require('path');

const keep = new Set([
  0x00D7, 0x2713, 0x2714, 0x2715,
  0x25B6, 0x25C0, 0x25BC, 0x25BE, 0x25B8, 0x25CF,
  0x21B3, 0x21C4, 0x2197, 0x2192,
]);

function stripDecor(str) {
  let out = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (keep.has(cp)) {
      out += ch;
      continue;
    }
    if (
      (cp >= 0x1F300 && cp <= 0x1FAFF) ||
      (cp >= 0x1F000 && cp <= 0x1F2FF) ||
      (cp >= 0x2600 && cp <= 0x26FF) ||
      (cp >= 0x2700 && cp <= 0x27BF) ||
      cp === 0x2B50 ||
      (cp >= 0x2300 && cp <= 0x23FF) ||
      cp === 0xFE0F ||
      cp === 0x200D
    ) {
      continue;
    }
    out += ch;
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

const files = ['public/dashboard.html', 'public/admin.html'];
for (const rel of files) {
  const file = path.join(__dirname, '..', rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = stripDecor(before);
  fs.writeFileSync(file, after);
  console.log(rel, before.length, '->', after.length);
}
