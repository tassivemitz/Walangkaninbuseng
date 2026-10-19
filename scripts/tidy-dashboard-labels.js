const fs = require('fs');
const path = require('path');

function tidy(str) {
  return str
    .replace(/\u2B06\uFE0F?/g, '')
    .replace(/>( +)([A-Za-z₱*#])/g, '>$2')
    .replace(/placeholder=" +/g, 'placeholder="')
    .replace(/=" ([A-Za-z₱#])/g, '="$1')
    .replace(/` ([A-Za-z₱#])/g, '`$1')
    .replace(/\$\{b\.icon\} /g, '')
    .replace(/, icon: ''/g, '')
    .replace(/icon: '', /g, '')
    .replace(/icon: ''/g, '')
    .replace(/[ \t]+\n/g, '\n');
}

for (const rel of ['public/dashboard.html', 'public/admin.html']) {
  const file = path.join(__dirname, '..', rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = tidy(before);
  fs.writeFileSync(file, after);
  console.log(rel, before.length, '->', after.length);
}
