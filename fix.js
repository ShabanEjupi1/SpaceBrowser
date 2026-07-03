const fs = require('fs');
let code = fs.readFileSync('src/main/extension-manager.ts', 'utf8');

// Fix 1: })();\, -> })();\,
code = code.replace(/}\)\(\);\\,/g, "})();\,");

// Fix 2: throw new Error(\Extension not found: \\); -> throw new Error(\Extension not found: \\);
code = code.replace(/new Error\(\\Extension not found: \\\\\);/g, "new Error(\Extension not found: \\);");

// Fix 3: console.log(\[ExtensionManager] Installed \\); -> console.log(\[ExtensionManager] Installed \\);
code = code.replace(/console\.log\(\\\\[ExtensionManager\\] Installed \\\\\);/g, "console.log(\[ExtensionManager] Installed \\);");

// Fix 4: console.log(\[ExtensionManager] Uninstalled \\); -> console.log(\[ExtensionManager] Uninstalled \\);
code = code.replace(/console\.log\(\\\\[ExtensionManager\\] Uninstalled \\\\\);/g, "console.log(\[ExtensionManager] Uninstalled \\);");

fs.writeFileSync('src/main/extension-manager.ts', code);
