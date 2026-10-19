const fs = require('fs');

function check(file) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [];
  let m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  console.log(file, 'inline scripts', scripts.length);
  scripts.forEach((code, i) => {
    try {
      new Function(code);
      console.log('  script', i, 'OK', code.length, 'chars');
    } catch (e) {
      console.log('  script', i, 'FAIL:', e.message);
    }
  });
}

check('public/dashboard.html');
check('public/admin.html');
