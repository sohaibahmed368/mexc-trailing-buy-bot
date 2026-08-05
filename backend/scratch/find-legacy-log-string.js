const fs = require('fs');
const path = require('path');

function searchDir(dir, query) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && !file.includes('node_modules') && !file.includes('.git') && !file.includes('dist')) {
      searchDir(fullPath, query);
    } else if (file.endsWith('.js') || file.endsWith('.tsx') || file.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes(query)) {
        console.log(`FOUND "${query}" IN FILE: ${fullPath}`);
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes(query)) console.log(`  Line ${idx + 1}: ${line.trim()}`);
        });
      }
    }
  }
}

console.log('Searching codebase for "BUY DEFERRED"...');
searchDir('C:\\Users\\Hi\\.gemini\\antigravity\\scratch\\mexc-trailing-buy-bot', 'BUY DEFERRED');
console.log('Searching codebase for ">= 60%"...');
searchDir('C:\\Users\\Hi\\.gemini\antigravity\\scratch\\mexc-trailing-buy-bot', '>= 60%');
