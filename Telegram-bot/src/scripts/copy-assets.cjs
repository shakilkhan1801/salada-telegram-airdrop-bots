const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');

function copyAssets() {
  console.log('Copying assets...');
  
  // Create data directory if it doesn't exist
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Created data directory');
  }

  // Create logs directory if it doesn't exist
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log('Created logs directory');
  }

  // Create dist directory if it doesn't exist
  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
    console.log('Created dist directory');
  }

  // Copy miniapp-captcha static files
  const miniappSrcDir = path.join(__dirname, '..', 'miniapp-captcha');
  const miniappDistDir = path.join(__dirname, '..', '..', 'dist', 'miniapp-captcha');
  
  if (fs.existsSync(miniappSrcDir)) {
    // Ensure destination directory exists
    if (!fs.existsSync(miniappDistDir)) {
      fs.mkdirSync(miniappDistDir, { recursive: true });
    }

    // Prefer obfuscated output if available
    const obfuscatedDir = path.join(miniappSrcDir, 'dist');
    const useObfuscated = fs.existsSync(obfuscatedDir);
    const sourceRoot = useObfuscated ? obfuscatedDir : miniappSrcDir;
    if (useObfuscated) {
      console.log('Using obfuscated MiniApp assets from src/miniapp-captcha/dist');
    } else {
      console.log('Using source MiniApp assets from src/miniapp-captcha');
    }
    
    // Copy static files (excluding .ts files as they're compiled separately)
    const staticFiles = ['index.html', 'styles.css', 'main.js', 'captcha-challenges.js', 'device-fingerprint.js'];
    
    staticFiles.forEach(file => {
      const srcPath = path.join(sourceRoot, file);
      const destPath = path.join(miniappDistDir, file);
      
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied ${file} to dist/miniapp-captcha/ ${useObfuscated ? '(obfuscated)' : ''}`);
      } else {
        console.warn(`Warning: ${file} not found in ${useObfuscated ? 'src/miniapp-captcha/dist' : 'src/miniapp-captcha'}`);
      }
    });
    
    console.log('MiniApp static files copied successfully!');
  } else {
    console.warn('Warning: src/miniapp-captcha directory not found');
  }

  const adminCandidates = [
    process.env.ADMIN_FRONTEND_BUILD_PATH,
    path.join(__dirname, '..', 'admin', 'frontend', 'dist'),
    path.join(__dirname, '..', '..', 'admin-panel', 'dist'),
    path.join(process.cwd(), '..', 'vibe-admin', 'dist'),
    path.join(process.cwd(), '..', 'vibe-admin-panel', 'dist'),
    path.join(process.cwd(), '..', 'admin-panel', 'dist')
  ].filter(Boolean);

  let adminFrontendSrc = adminCandidates.find(p => fs.existsSync(p));
  const adminFrontendDest = path.join(__dirname, '..', '..', 'dist', 'admin', 'frontend', 'dist');
  
  if (!adminFrontendSrc) {
    try {
      const { execSync } = require('child_process');
      const adminPanelDirs = [
        path.join(process.cwd(), '..', 'admin-panel'),
        path.join(__dirname, '..', '..', 'admin-panel')
      ];
      const adminPanelDir = adminPanelDirs.find(d => fs.existsSync(path.join(d, 'package.json')));
      if (adminPanelDir) {
        const nodeModules = path.join(adminPanelDir, 'node_modules');
        if (!fs.existsSync(nodeModules)) {
          console.log('Installing admin panel dependencies...');
          execSync(`npm ci --prefix "${adminPanelDir}" --no-audit --no-fund`, { stdio: 'inherit' });
        }
        console.log('Building admin panel frontend...');
        execSync(`npm run build --prefix "${adminPanelDir}"`, { stdio: 'inherit' });
        adminFrontendSrc = path.join(adminPanelDir, 'dist');
      }
    } catch (e) {
      console.warn('Warning: failed to build admin panel automatically:', e?.message || String(e));
    }
  }

  if (adminFrontendSrc && fs.existsSync(adminFrontendSrc)) {
    fse.ensureDirSync(adminFrontendDest);
    fse.emptyDirSync(adminFrontendDest);
    fse.copySync(adminFrontendSrc, adminFrontendDest, { dereference: true });
    console.log('Admin frontend build copied to dist/admin/frontend/dist');
  } else {
    console.warn('Warning: admin frontend build not found. Set ADMIN_FRONTEND_BUILD_PATH or place build at admin-panel/dist.');
  }

  console.log('Assets copied successfully!');
}

copyAssets();