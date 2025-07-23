const fs = require('fs');
const path = require('path');

const configPath = path.resolve(__dirname, 'node_modules', 'react-scripts', 'config', 'webpack.config.js');

fs.readFile(configPath, 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading webpack.config.js:', err);
        return;
    }

    let updatedData = data;

    // Patching 'fallback' for Node.js core modules
    const fallbackRegex = /fallback:\s*\{(.*?)\}/s;
    if (!fallbackRegex.test(updatedData)) {
        // If fallback doesn't exist, inject it
        updatedData = updatedData.replace(
            /resolve:\s*\{/,
            `resolve: {\n    fallback: {\n        "crypto": require.resolve("crypto-browserify"),\n        "stream": require.resolve("stream-browserify"),\n        "assert": require.resolve("assert"),\n        "http": require.resolve("stream-http"),\n        "https": require.resolve("https-browserify"),\n        "os": require.resolve("os-browserify"),\n        "url": require.resolve("url"),\n        "path": require.resolve("path-browserify"),\n        "fs": false,\n        "net": false,\n        "tls": false,\n        "zlib": require.resolve("browserify-zlib")\n    },\n`
        );
    } else {
        // If fallback exists, add missing entries or ensure false for fs/net/tls
        updatedData = updatedData.replace(
            fallbackRegex,
            (match, p1) => {
                let newFallbackContent = p1;
                const modulesToAdd = {
                    "crypto": 'require.resolve("crypto-browserify")',
                    "stream": 'require.resolve("stream-browserify")',
                    "assert": 'require.resolve("assert")',
                    "http": 'require.resolve("stream-http")',
                    "https": 'require.resolve("https-browserify")',
                    "os": 'require.resolve("os-browserify")',
                    "url": 'require.resolve("url")',
                    "path": 'require.resolve("path-browserify")',
                    "zlib": 'require.resolve("browserify-zlib")'
                };
                const modulesToFalse = ["fs", "net", "tls"];

                for (const mod in modulesToAdd) {
                    if (!newFallbackContent.includes(`"${mod}"`)) {
                        newFallbackContent += `,\n        "${mod}": ${modulesToAdd[mod]}`;
                    }
                }
                for (const mod of modulesToFalse) {
                    if (!newFallbackContent.includes(`"${mod}": false`)) {
                        newFallbackContent += `,\n        "${mod}": false`;
                    }
                }
                return `fallback: {${newFallbackContent}}`;
            }
        );
    }

    // Patching 'plugins' for process and Buffer
    const pluginsRegex = /(new webpack\.ProvidePlugin\(\{.*?\n\s*\}\)),?/s; // Regex to find existing ProvidePlugin
    if (!pluginsRegex.test(updatedData)) {
        updatedData = updatedData.replace(
            /(new webpack\.DefinePlugin\({[\s\S]*?}\),\n)/, // Look for DefinePlugin to insert after
            `$1  new webpack.ProvidePlugin({\n    process: 'process/browser',\n    Buffer: ['buffer', 'Buffer']\n  }),\n`
        );
    } else {
        // If it exists, ensure process and Buffer are included
        updatedData = updatedData.replace(
            pluginsRegex,
            (match, p1) => {
                let newProvideContent = p1;
                if (!newProvideContent.includes("process: 'process/browser'")) {
                    newProvideContent = newProvideContent.replace('}', ", process: 'process/browser'}");
                }
                if (!newProvideContent.includes("Buffer: ['buffer', 'Buffer']")) {
                    newProvideContent = newProvideContent.replace('}', ", Buffer: ['buffer', 'Buffer']}");
                }
                return newProvideContent;
            }
        );
    }

    // Add rule for .mjs files for sql.js if it's missing
    const mjsRuleRegex = /test:\s*\/\\.mjs\$\/,[\s\S]*?type:\s*"javascript\/auto"/;
    if (!mjsRuleRegex.test(updatedData)) {
        updatedData = updatedData.replace(
            /(use:[\s\S]*?\}\s*\}\s*\]\s*\}\s*\},)/, // Find a good place after existing rules
            `$1\n            {\n              test: /\\.mjs$/,\n              include: /node_modules/,\n              type: "javascript/auto"\n            },`
        );
    }


    fs.writeFile(configPath, updatedData, 'utf8', (err) => {
        if (err) {
            console.error('Error writing patched webpack.config.js:', err);
            return;
        }
        console.log('Successfully patched webpack.config.js!');
    });
});