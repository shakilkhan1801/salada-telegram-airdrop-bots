const fs = require('fs');
const path = require('path');

// Create directories if they don't exist
const dirs = [
    'dist/miniapp-captcha',
    'dist/admin/frontend/dist'
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Copy miniapp-captcha static files
const miniappFiles = ['index.html', 'styles.css', 'main.js'];
miniappFiles.forEach(file => {
    const src = path.join('src/miniapp-captcha', file);
    const dest = path.join('dist/miniapp-captcha', file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file} to dist/miniapp-captcha/`);
    }
});

console.log('Assets copied successfully!');
