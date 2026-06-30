/**
 * Copy web files to www/ directory for Capacitor
 */
const fs = require('fs');
const path = require('path');

const SRC = __dirname.replace(/[\\/]scripts$/, '');
const DEST = path.join(SRC, 'www');

// Directories to copy
const DIRS = ['css', 'js', 'assets'];

// Files to copy from root
const FILES = ['app.html', 'manifest.json'];

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    const stat = fs.statSync(srcPath);
    
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Clean and recreate www
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
}
fs.mkdirSync(DEST, { recursive: true });

// Copy directories
for (const dir of DIRS) {
  const srcDir = path.join(SRC, dir);
  if (fs.existsSync(srcDir)) {
    copyDir(srcDir, path.join(DEST, dir));
    console.log('  ✓ ' + dir + '/');
  }
}

// Copy root files
for (const file of FILES) {
  const srcFile = path.join(SRC, file);
  if (fs.existsSync(srcFile)) {
    const destName = file === 'app.html' ? 'index.html' : file;
    fs.copyFileSync(srcFile, path.join(DEST, destName));
    console.log('  ✓ ' + destName);
  }
}

console.log('✅ www/ updated');
