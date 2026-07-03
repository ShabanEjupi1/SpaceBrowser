const fs = require('fs');
let code = fs.readFileSync('src/main/extension-manager.ts', 'utf8');

code = code.replace(
  /'<style>@keyframes stBubbleIn\{from\{opacity:0;transform:translateY\(6px\)\}to\{opacity:1;transform:translateY\(0\)\}\}<\\/style>'\\s*\\n\\s*\\+'<div style="display:flex;/,
  '\\'<div style="display:flex;'
);

code = code.replace(
  /'<button onclick="document.getElementById\\(\\'space-translate-sel-popup\\'\\).remove\\(\\)" style="([^"]+)">✕<\\/button>'/g,
  '\\'<button id="space-translate-sel-close" style="">✕</button>\\''
);

code = code.replace(
  /document\.body\.appendChild\(popup\);/,
  "document.body.appendChild(popup);\\n      var selClose = document.getElementById('space-translate-sel-close');\\n      if (selClose) selClose.addEventListener('click', function() { popup.remove(); });"
);

code = code.replace(
  /'<button onclick="document.getElementById\\(\\'space-translator-panel\\'\\).remove\\(\\)" style="([^"]+)">✕<\\/button>'/g,
  '\\'<button id="space-translator-close" style="">✕</button>\\''
);

code = code.replace(
  /'<button id="space-translator-go" onclick="runTranslation\\(\\)" style="([^"]+)">([^<]+)<\\/button>'/g,
  '\\'<button id="space-translator-go" style=""></button>\\''
);

code = code.replace(
  /document\.body\.appendChild\(panel\);/,
  "document.body.appendChild(panel);\\n      var panelClose = document.getElementById('space-translator-close');\\n      if (panelClose) panelClose.addEventListener('click', function() { panel.remove(); });\\n      var panelGo = document.getElementById('space-translator-go');\\n      if (panelGo) panelGo.addEventListener('click', function() { window.runTranslation(); });"
);

fs.writeFileSync('src/main/extension-manager.ts', code);
