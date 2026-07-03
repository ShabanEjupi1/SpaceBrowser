const fs = require('fs');
let c = fs.readFileSync('src/main/extension-manager.ts', 'utf8');

c = c.replace(/contentScript:[ \t]*\\(function\(\)\{\s*\/\/[ \t]*Reader mode script[\s\w\W]*?\}\)\(\);\/g, 
  "contentScript: \(function(){ document.addEventListener('keydown', e => { if(e.altKey && e.shiftKey && e.code === 'KeyR') { e.preventDefault(); if(document.getElementById('space-reader-over')) { document.getElementById('space-reader-over').remove(); return; } const t = document.body.innerText.replace(/</g, '&lt;').replace(/>/g, '&gt;'); const div = document.createElement('div'); div.id = 'space-reader-over'; div.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fefefe;color:#222;z-index:9999999;overflow-y:auto;padding:40px 10%;font-size:18px;font-family:serif;line-height:1.6;'; div.innerHTML = '<button onclick=\\"this.parentNode.remove()\\" style=\\"position:fixed;top:20px;right:20px;padding:8px 12px;background:#ddd;border:none;cursor:pointer;\\">Close</button><div style=\\"max-width:800px;margin:0 auto;white-space:pre-wrap;\\">' + t + '</div>'; document.body.appendChild(div); } }); })();\");

c = c.replace(/contentScript:[ \t]*\\(function\(\)\{\s*\/\/[ \t]*Tab suspender\s*\}\)\(\);\/g,
  "contentScript: \(function(){ let t; const r = () => { clearTimeout(t); t = setTimeout(() => { if(window.chrome && chrome.runtime) chrome.runtime.sendMessage({action:'suspend_tab'}).catch(()=>{}); }, 1800000); }; window.addEventListener('mousemove',r); window.addEventListener('keydown',r); r(); })();\");

c = c.replace(/contentScript:[ \t]*\\(function\(\)\{\s*\/\/[ \t]*Password gen\s*\}\)\(\);\/g,
  "contentScript: \(function(){ document.addEventListener('click', e => { if(e.target && e.target.tagName === 'INPUT' && e.target.type === 'password' && e.altKey) { const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+'; let pass = ''; for(let i=0; i<16; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length)); e.target.value = pass; const ev = new Event('input', { bubbles: true }); e.target.dispatchEvent(ev); } }); })();\");

c = c.replace(/contentScript:[ \t]*\\(function\(\)\{\s*\/\/[ \t]*Screenshot\s*\}\)\(\);\/g,
  "contentScript: \(function(){ document.addEventListener('keydown', e => { if(e.altKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); if(window.chrome && chrome.runtime) { chrome.runtime.sendMessage({action:'capture'}, res => { if(res&&res.data){ let a=document.createElement('a'); a.download='screenshot.png'; a.href=res.data; a.click(); } }).catch(()=>{ /* fallback logic could go here */ }); } else { alert('Use Alt+Shift+P to screenshot - handled by native browser'); } } }); })();\");

c = c.replace(/contentScript:[ \t]*\\(function\(\)\{\s*\/\/[ \t]*JSON Formatter\s*\}\)\(\);\/g,
  "contentScript: \(function(){ if(document.contentType!=='application/json' && !document.body.innerText.trim().startsWith('{') && !document.body.innerText.trim().startsWith('[')) return; try { const d = JSON.parse(document.body.innerText); document.body.innerHTML = '<pre style=\"background:#1e1e19;color:#d4d4d4;padding:20px;font-size:14px;white-space:pre-wrap;word-wrap:break-word;\">' + JSON.stringify(d, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>'; } catch(e){} })();\");

fs.writeFileSync('src/main/extension-manager.ts', c);
