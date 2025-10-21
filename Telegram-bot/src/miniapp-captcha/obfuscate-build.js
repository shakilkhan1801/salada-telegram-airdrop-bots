const fs = require('fs');
const path = require('path');

// Try to load obfuscator, but gracefully handle if not installed
let JavaScriptObfuscator;
try {
    JavaScriptObfuscator = require('javascript-obfuscator');
} catch (e) {
    console.log('⚠️  javascript-obfuscator not installed, copying files without obfuscation');
    console.log('   Run "npm install javascript-obfuscator" to enable obfuscation');
}

// Configuration for obfuscation
const obfuscatorOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: true,
    debugProtectionInterval: 4000,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    rotateUnicodeArray: true,
    selfDefending: true,
    shuffleStringArray: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

// Files to obfuscate
const filesToObfuscate = [
    'main.js',
    'device-fingerprint.js'
];

// Create dist folder if it doesn't exist
const distPath = path.join(__dirname, 'dist');
if (!fs.existsSync(distPath)) {
    fs.mkdirSync(distPath, { recursive: true });
}

// Copy HTML and CSS files
fs.copyFileSync(
    path.join(__dirname, 'index.html'),
    path.join(distPath, 'index.html')
);
fs.copyFileSync(
    path.join(__dirname, 'styles.css'),
    path.join(distPath, 'styles.css')
);

// Obfuscate JavaScript files (or just copy if obfuscator not available)
filesToObfuscate.forEach(file => {
    const inputPath = path.join(__dirname, file);
    const outputPath = path.join(distPath, file);
    
    try {
        const code = fs.readFileSync(inputPath, 'utf8');
        
        if (JavaScriptObfuscator) {
            console.log(`Obfuscating ${file}...`);
            const obfuscationResult = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions);
            fs.writeFileSync(outputPath, obfuscationResult.getObfuscatedCode());
            console.log(`✓ ${file} obfuscated successfully`);
        } else {
            console.log(`Copying ${file} (obfuscation skipped)...`);
            fs.writeFileSync(outputPath, code);
            console.log(`✓ ${file} copied`);
        }
    } catch (error) {
        console.error(`✗ Error processing ${file}:`, error.message);
    }
});

// Update HTML to disable source maps
let htmlContent = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');

// Add additional protection scripts
const protectionScript = `
<script>
// Advanced protection
(function() {
    'use strict';
    
    // Disable source maps
    if (typeof window.sourceMapSupport !== 'undefined') {
        window.sourceMapSupport = undefined;
    }
    
    // Override toString methods
    Function.prototype.toString = function() {
        return 'function () { [native code] }';
    };
    
    // Block source viewing
    Object.defineProperty(document, 'currentScript', {
        get: function() { return null; }
    });
    
    // Clear traces
    setTimeout(function() {
        try {
            const scripts = document.getElementsByTagName('script');
            for (let i = scripts.length - 1; i >= 0; i--) {
                if (scripts[i].src.includes('.js')) {
                    scripts[i].removeAttribute('src');
                    scripts[i].innerHTML = '// Content unavailable. Resource was not cached.';
                }
            }
        } catch(e) {}
    }, 1000);
})();
</script>
`;

// Insert protection script before closing body tag (only if obfuscation was enabled)
if (JavaScriptObfuscator) {
    htmlContent = htmlContent.replace('</body>', protectionScript + '</body>');
}
fs.writeFileSync(path.join(distPath, 'index.html'), htmlContent);

console.log('\n✓ Build complete! Files are in the dist/ folder');
if (!JavaScriptObfuscator) {
    console.log('⚠️  Files were copied without obfuscation');
    console.log('   Run "npm install javascript-obfuscator" to enable obfuscation');
}