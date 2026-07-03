import { app } from 'electron';
import Store from 'electron-store';
import * as path from 'path';
import * as fs from 'fs';
const extsStore = new Store({ name: 'browser-prefs' });

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category?: 'productivity' | 'developer' | 'ai' | 'privacy' | 'theme' | 'other';
  icon?: string;
  permissions?: string[];
  contentScript?: string;
  backgroundScript?: string;
  rating?: number;
  installs?: number;
  tags?: string[];
  _installed?: boolean;
  _enabled?: boolean;
}

export interface InstalledExtension {
  id: string;
  enabled: boolean;
  pinned: boolean; // Pinned to toolbar
}

export const BUILT_IN_EXTENSIONS: ExtensionManifest[] = [
  {
    id: 'space-ad-blocker',
    name: 'Space Shield (Ad Blocker)',
    version: '2.1.0',
    description: 'Blocks advertisements, trackers, and pop-ups site-wide. Faster page loads. Privacy first.',
    author: 'Space Team',
    category: 'privacy',
    icon: '🛡️',
    permissions: ['webRequest', 'tabs', 'storage'],
    contentScript: `(function(){
      const adSelectors = '.ad, .ads, .advert, .advertisement, [id*="google_ads"], [class*="adsbygoogle"]';
      function clean(){document.querySelectorAll(adSelectors).forEach(el=>{try{el.remove()}catch(_){}});}
      clean();
      const obs=new MutationObserver(clean);
      obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
    })();`
  },
  {
    id: 'space-reader-mode',
    name: 'Focus Reader',
    version: '1.0.3',
    description: 'One click to strip a page down to pure, distraction-free reading with adjustable font size and background.',
    author: 'Space Team',
    category: 'productivity',
    icon: '📖',
    permissions: ['tabs', 'storage'],
    contentScript: `(function(){
      if(window.__focusReaderInjected) {
        if(window.__toggleFocusReader) window.__toggleFocusReader();
        return;
      }
      window.__focusReaderInjected = true;
      window.__toggleFocusReader = function(){
        if(document.getElementById('space-reader-over')) { 
          document.getElementById('space-reader-over').remove(); 
          document.body.style.overflow = '';
          return; 
        } 
        
        // Find best readable container
        var selectors=['article','[role="article"]','main','[role="main"]','.article-body','.post-content','.entry-content','.content','#content','#main'];
        var src=null;
        for(var i=0;i<selectors.length;i++){
           var el=document.querySelector(selectors[i]);
           if(el && (el.innerText||'').trim().length>300){ src=el; break; }
        }
        if(!src) src=document.body;
        
        // Build reader view content
        var title = document.querySelector('h1')?.innerText || document.title || 'Focus Reader';
        var clone = src.cloneNode(true);
        clone.querySelectorAll('script,style,nav,header,footer,aside,iframe,form,.ad,.ads,button').forEach(n => { try{n.remove()}catch(e){} });
        
        // Convert to minimal safe HTML
        var contentHtml = '';
        clone.querySelectorAll('p, h2, h3, h4, li').forEach(el => {
           var txt = el.innerText.trim();
           if(txt.length > 0) {
              if(el.tagName === 'P' || el.tagName === 'LI') contentHtml += '<p style="margin-bottom:1.2em;line-height:1.8;color:#d1d5db;">' + txt.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
              else contentHtml += '<' + el.tagName.toLowerCase() + ' style="margin-top:1.5em;margin-bottom:0.5em;color:#f3f4f6;">' + txt.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</' + el.tagName.toLowerCase() + '>';
           }
        });
        if(!contentHtml) {
           var t = clone.innerText.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
           contentHtml = '<p style="margin-bottom:1.2em;line-height:1.8;color:#d1d5db;white-space:pre-wrap;">' + t + '</p>';
        }

        const div = document.createElement('div'); 
        div.id = 'space-reader-over'; 
        div.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0f172a;color:#d1d5db;z-index:2147483647;overflow-y:auto;padding:60px 20px;font-size:18px;font-family:Georgia, serif;box-sizing:border-box;transition:opacity 0.2s;'; 
        div.innerHTML = 
          '<div style="max-width:720px;margin:0 auto;position:relative;">' +
            '<button onclick="document.getElementById(\\'space-reader-over\\').remove(); document.body.style.overflow=\\'\\';" style="position:absolute;top:-40px;right:0;padding:8px 16px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:#fff;border-radius:6px;font-size:14px;font-family:sans-serif;transition:background 0.2s;">✕ Close Reader</button>' +
            '<h1 style="font-size:32px;font-family:sans-serif;color:#f8fafc;margin-bottom:30px;line-height:1.3;border-bottom:1px solid #334155;padding-bottom:20px;">' + title.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</h1>' +
            contentHtml + 
          '</div>'; 
        
        document.body.appendChild(div);
        document.body.style.overflow = 'hidden';
      };
      document.addEventListener('keydown', e => {
        if(e.altKey && e.shiftKey && e.code === 'KeyR') {
           e.preventDefault();
           window.__toggleFocusReader();
        }
      });
      // Execute immediately since we are doing 'run on this page'
      window.__toggleFocusReader();
    })();`
  },
  {
    id: 'space-tab-suspender',
    name: 'Tab Suspender',
    version: '1.1.0',
    description: 'Automatically suspends inactive tabs after a configurable delay to save memory and CPU.',
    author: 'Space Team',
    category: 'productivity',
    icon: '💤',
    permissions: ['tabs', 'storage'],
    contentScript: `(function(){
      let t; 
      const r = () => { 
        clearTimeout(t); 
        t = setTimeout(() => { 
           // Request suspension from the main process (will be handled if using a preload IPC or chrome.runtime shim)
           if(window.chrome && chrome.runtime) chrome.runtime.sendMessage({action:'suspend_tab'}).catch(()=>{}); 
        }, 1800000); 
      }; 
      window.addEventListener('mousemove',r); 
      window.addEventListener('keydown',r); 
      r(); 
      // If manually run, suspend immediately
      if(window.chrome && chrome.runtime) chrome.runtime.sendMessage({action:'suspend_tab'}).catch(()=>{});
    })();`
  },
  {
    id: 'space-password-gen',
    name: 'Password Generator',
    version: '1.0.1',
    description: 'Generate strong, random passwords directly in any password field with one click.',
    author: 'Space Team',
    category: 'productivity',
    icon: '🔑',
    permissions: ['storage'],
    contentScript: `(function(){
      if(window.__spacePasswordGenInjected) {
         window.__runPasswordGen();
         return;
      }
      window.__spacePasswordGenInjected = true;
      window.__runPasswordGen = function() {
         const pcs = document.querySelectorAll('input[type="password"]');
         if (pcs.length > 0) {
            const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+'; 
            let pass = ''; 
            for(let i=0; i<16; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length)); 
            pcs.forEach(pw => {
              pw.value = pass; 
              pw.dispatchEvent(new Event('input', { bubbles: true }));
            });
         } else {
            alert("No password fields found on this page.");
         }
      };
      document.addEventListener('click', e => { 
        if(e.target && e.target.tagName === 'INPUT' && e.target.type === 'password' && e.altKey) { 
           window.__runPasswordGen();
        } 
      });
      window.__runPasswordGen();
    })();`
  },
  {
    id: 'space-screenshot',
    name: 'Page Screenshot',
    version: '1.0.0',
    description: 'Capture a full-page screenshot and save it as PNG with a single keyboard shortcut.',
    author: 'Space Team',
    category: 'developer',
    icon: '📸',
    permissions: ['tabs'],
    contentScript: `(function(){
      if(window.__spaceScreenshotInjected) {
         window.__runScreenshot();
         return;
      }
      window.__spaceScreenshotInjected = true;
      window.__runScreenshot = function() {
         if(window.chrome && chrome.runtime) { 
           chrome.runtime.sendMessage({action:'capture'}, res => { 
             if(res&&res.data){ 
               let a=document.createElement('a'); a.download='screenshot.png'; a.href=res.data; a.click(); 
             } 
           }).catch(()=>{}); 
         } else { 
           alert('Screenshot requested (normally handled by Alt+Shift+P or native action)'); 
         }
      };
      document.addEventListener('keydown', e => { 
        if(e.altKey && e.shiftKey && e.code === 'KeyP') { 
          e.preventDefault(); 
          window.__runScreenshot();
        } 
      });
      window.__runScreenshot();
    })();`
  },
  {
    id: 'space-json-formatter',
    name: 'JSON Formatter',
    version: '2.0.0',
    description: 'Automatically formats raw JSON responses in browser tabs.',
    author: 'Space Team',
    category: 'developer',
    icon: '{ }',
    permissions: ['tabs'],
    contentScript: `(function(){
      if(document.contentType!=='application/json' && !document.body.innerText.trim().startsWith('{') && !document.body.innerText.trim().startsWith('[')) return; 
      try { 
        const d = JSON.parse(document.body.innerText); 
        document.body.innerHTML = '<pre style="background:#1e1e19;color:#d4d4d4;padding:20px;font-size:14px;white-space:pre-wrap;word-wrap:break-word;">' + JSON.stringify(d, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>'; 
      } catch(e){}
    })();`
  },
  {
    id: 'space-translator',
    name: 'Page Translator',
    version: '2.0.0',
    description: 'Translate any selected text or the full page instantly.',
    author: 'Space Team',
    category: 'ai',
    icon: '🌐',
    permissions: ['tabs', 'ai'],
    contentScript: `(function(){
  if(window.__spaceTranslatorInjected){
    if(window.openPageTranslator) window.openPageTranslator();
    return;
  }
  window.__spaceTranslatorInjected=true;

  var LANGUAGES=[['\\u{1F1FA}\\u{1F1F8} English','en'],['\\u{1F1EA}\\u{1F1F8} Spanish','es'],['\\u{1F1EB}\\u{1F1F7} French','fr'],['\\u{1F1E9}\\u{1F1EA} German','de'],['\\u{1F1EE}\\u{1F1F9} Italian','it'],['\\u{1F1F5}\\u{1F1F9} Portuguese','pt'],['\\u{1F1F3}\\u{1F1F1} Dutch','nl'],['\\u{1F1F7}\\u{1F1FA} Russian','ru'],['\\u{1F1E8}\\u{1F1F3} Chinese','zh'],['\\u{1F1EF}\\u{1F1F5} Japanese','ja'],['\\u{1F1F0}\\u{1F1F7} Korean','ko'],['\\u{1F1E6}\\u{1F1F1} Albanian','sq'],['\\u{1F1F8}\\u{1F1E6} Arabic','ar']];
  var targetLang='\\u{1F1FA}\\u{1F1F8} English';

  function getLangCode(name) {
    for (var i = 0; i < LANGUAGES.length; i++) {
        if (LANGUAGES[i][0] === name) return LANGUAGES[i][1];
    }
    return 'en';
  }

  document.addEventListener('mouseup', function(e) {
    if(document.getElementById('space-translate-sel-popup') && e.target.closest('#space-translate-sel-popup')) return;
    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if(text.length > 5 && text.length < 1000) {
      setTimeout(function(){showTranslateSelection(text, e.pageX, e.pageY);}, 50);
    }
  });

  function showTranslateSelection(text, x, y) {
    var existing = document.getElementById('space-translate-sel-popup');
    if(existing) existing.remove();

    var popup = document.createElement('div');
    popup.id = 'space-translate-sel-popup';
    popup.style.cssText = 'position:absolute;top:'+(y+15)+'px;left:'+x+'px;width:320px;background:#13131c;border:1px solid rgba(255,255,255,0.1);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:2147483647;font-family:sans-serif;overflow:hidden;animation:stBubbleIn 0.15s ease-out;';

    var langOpts = LANGUAGES.map(function(l){
      return '<option value="'+l[0]+'"'+(l[0]===targetLang?' selected':'')+'>'+l[0]+'</option>';
    }).join('');

    popup.innerHTML = 
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.07);">'
      +'<span style="font-size:14px;">\\u{1F310}</span>'
      +'<select id="space-sel-lang" style="flex:1;background:#1a1a28;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#c0c0d8;font-size:12px;padding:4px 6px;">'+langOpts+'</select>'
      +'<button id="space-translate-sel-close" style="background:none;border:none;color:#555568;cursor:pointer;font-size:14px;padding:2px 4px;flex-shrink:0;">✕</button>'
      +'</div>'
      +'<div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;">'
      +'<div style="font-size:11.5px;color:#666680;font-weight:600;margin-bottom:4px;letter-spacing:0.03em;">ORIGINAL</div>'
      +'<div style="font-size:12.5px;color:#8888aa;line-height:1.5;max-height:56px;overflow:hidden;text-overflow:ellipsis;">'+text.slice(0,160)+(text.length>160?'…':'')+'</div>'
      +'</div>'
      +'<div style="padding:10px 12px;background:#171722;min-height:60px;">'
      +'<div style="font-size:11.5px;color:#2563eb;font-weight:600;margin-bottom:4px;letter-spacing:0.03em;">TRANSLATED</div>'
      +'<div id="space-sel-output" style="font-size:13px;color:#e0e0ec;line-height:1.6;white-space:pre-wrap;">Translating...</div>'
      +'</div>';
    
    document.body.appendChild(popup);

    var closeBtn = document.getElementById('space-translate-sel-close');
    var langSel = document.getElementById('space-sel-lang');
    if (closeBtn) closeBtn.addEventListener('click', function() { popup.remove(); });
    if(langSel){langSel.addEventListener('change',function(){targetLang=this.value;doTranslateText(text,this.value);});}

    doTranslateText(text,targetLang);
  }

  function doTranslateText(text,lang){
    var output=document.getElementById('space-sel-output');
    if(!output)return;
    output.innerHTML='<span style="color:#444460;font-size:12px;">Translating to '+lang+'…</span>';

    var api=window.spaceAPI;
    var useAI = false; // api && api.ai && api.ai.chat && api.ai.status && api.ai.status().status === 'loaded';

    if (useAI) {
      var messages=[
        {role:'system',content:'You are a professional translator. Translate the text below to '+lang+'. Output ONLY the translation — no explanations, no quotation marks, no labels.'},
        {role:'user',content:text}
      ];
      var reqId='sel-translate-'+Date.now();
      output.textContent='';

      var unsub=api.ai.onToken(function(data){
        if(data.requestId!==reqId)return;
        if(data.error){output.innerHTML='<span style="color:#f87171;font-size:12px;">Error: '+data.error+'</span>';if(unsub)unsub();return;}
        if(data.token)output.textContent+=data.token;
        if(data.isFinal){if(unsub)unsub();}
      });
      api.ai.chat(messages,{maxTokens:1024,temperature:0.2},reqId).catch(function(err){
        if(output)output.innerHTML='<span style="color:#f87171;font-size:12px;">Translation failed.</span>';
      });
    } else {
      var code = getLangCode(lang);
      var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + code + '&dt=t';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: 'q=' + encodeURIComponent(text)
      }).then(function(r){return r.json();}).then(function(d){
        var res='';
        if(d&&d[0]) for(var i=0;i<d[0].length;i++) res+=d[0][i][0];
        output.textContent=res||'Translation failed.';
      }).catch(function(){
        output.innerHTML='<span style="color:#f87171;font-size:12px;">Translation failed.</span>';
      });
    }
  }

  window.__spaceTranslator = true;
  window.doTranslateTextDirect = function(text, targetLang) {
    var rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    showTranslateSelection(text, rect.left + window.scrollX, rect.bottom + window.scrollY);
    
    var sel = document.getElementById('space-sel-lang');
    if (sel) {
      sel.value = targetLang;
      sel.dispatchEvent(new Event('change'));
    }
  };

  function extractPageText(){
    var clone=document.body.cloneNode(true);
    clone.querySelectorAll('script,style,nav,header,footer,aside,iframe').forEach(function(n){try{n.remove();}catch(_){}});
    return (clone.innerText||clone.textContent||'').trim().slice(0,6000);
  }

  window.openPageTranslator = function(){
    var existing=document.getElementById('space-translator-panel');
    if(existing){existing.remove();return;}

    var langOpts=LANGUAGES.map(function(l){
      return '<option value="'+l[0]+'"'+(l[0]===targetLang?' selected':'')+'>'+l[0]+'</option>';
    }).join('');

    var panel=document.createElement('div');
    panel.id='space-translator-panel';
    panel.style.cssText='position:fixed;top:0;right:0;width:380px;height:100vh;background:#0d0d15;border-left:1px solid rgba(37,99,235,0.25);z-index:2147483647;display:flex;flex-direction:column;font-family:sans-serif;box-shadow:-8px 0 32px rgba(0,0,0,0.6);';
    panel.innerHTML=
      '<div style="padding:14px 16px;background:#13131c;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;align-items:center;gap:10px;">'
      +'<span style="font-size:16px;">\\u{1F310}</span>'
      +'<span style="font-weight:700;font-size:14px;color:#e0e0ec;flex:1;">Page Translator</span>'
      +'<button id="space-translator-close" style="background:none;border:none;color:#666680;cursor:pointer;font-size:16px;padding:2px 6px;">✕</button>'
      +'</div>'
      +'<div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">'
      +'<label style="font-size:11px;color:#666680;font-weight:600;letter-spacing:0.05em;">TARGET LANGUAGE</label>'
      +'<select id="space-translator-lang" style="width:100%;margin-top:6px;background:#1a1a28;border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#e0e0ec;font-size:13px;padding:7px 10px;">'+langOpts+'</select>'
      +'<button id="space-translator-go" style="width:100%;margin-top:10px;background:#2563eb;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;padding:9px;cursor:pointer;">Translate This Page</button>'
      +'</div>'
      +'<div id="space-translator-output" style="flex:1;overflow-y:auto;padding:14px 16px;font-size:13px;line-height:1.7;color:#c0c0d8;white-space:pre-wrap;"></div>';
    document.body.appendChild(panel);

    var closeBtn = document.getElementById('space-translator-close');
    var goBtnElem = document.getElementById('space-translator-go');
    if(closeBtn) closeBtn.addEventListener('click', function(){ panel.remove(); });
    if(goBtnElem) goBtnElem.addEventListener('click', function(){ window.runTranslation(); });
  }

  window.runTranslation=function(){
    var lang=document.getElementById('space-translator-lang');
    var output=document.getElementById('space-translator-output');
    var goBtn=document.getElementById('space-translator-go');
    if(!lang||!output||!goBtn)return;
    targetLang=lang.value;
    var text=extractPageText();
    if(!text){output.textContent='No readable content found on this page.';return;}
    output.innerHTML='<span style="color:#666680;font-size:12px;">Translating to '+targetLang+'…</span>';
    goBtn.disabled=true;goBtn.textContent='Translating…';
    
    var api=window.spaceAPI;
    var useAI = false;

    if (useAI) {
      if(!api||!api.ai||!api.ai.chat){
        output.innerHTML='<span style="color:#f87171;">⚠ Space AI engine not available. Load a model in the AI sidebar first.</span>';
        goBtn.disabled=false;goBtn.textContent='Translate This Page';
        return;
      }
      var messages=[
        {role:'system',content:'You are a professional translator. Translate the following page content into '+targetLang+'. Preserve paragraph structure. Output only the translation, no extra commentary.'},
        {role:'user',content:text}
      ];
      var reqId='page-translate-'+Date.now();
      output.textContent='';
      var unsub=api.ai.onToken(function(data){
        if(data.requestId!==reqId)return;
        if(data.error){output.innerHTML+='<span style="color:#f87171;">Error: '+data.error+'</span>';goBtn.disabled=false;goBtn.textContent='Translate This Page';if(unsub)unsub();return;}
        if(data.token)output.textContent+=data.token;
        if(data.isFinal){goBtn.disabled=false;goBtn.textContent='Translate This Page';if(unsub)unsub();}
      });
      api.ai.chat(messages,{maxTokens:2048,temperature:0.3},reqId).catch(function(err){
        output.innerHTML='<span style="color:#f87171;">Translation failed: '+err.message+'</span>';
        goBtn.disabled=false;goBtn.textContent='Translate This Page';
      });
    } else {
      var code = getLangCode(targetLang);
      var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + code + '&dt=t';
      
      output.textContent = '';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: 'q=' + encodeURIComponent(text)
      }).then(function(r){return r.json();}).then(function(d){
        var res='';
        if(d&&d[0]) for(var j=0;j<d[0].length;j++) res+=d[0][j][0];
        output.textContent = res || 'Translation failed.';
        goBtn.disabled=false;goBtn.textContent='Translate This Page';
      }).catch(function(){
        output.innerHTML='<span style="color:#f87171;font-size:12px;">Translation failed. Check encoding or network.</span>';
        goBtn.disabled=false;goBtn.textContent='Translate This Page';
      });
    }
  };

  function createTranslateBtn(){
    if(document.getElementById('space-translate-btn'))return;
    var btn=document.createElement('button');
    btn.id='space-translate-btn';
    btn.title='Translate page (Alt+Shift+T)';
    btn.textContent='🌐 Translate';
    btn.style.cssText='position:fixed;bottom:58px;right:16px;background:#13131c;border:1px solid rgba(37,99,235,0.5);border-radius:8px;padding:7px 14px;font-size:12px;font-family:sans-serif;font-weight:600;color:#7090e0;cursor:pointer;z-index:2147483645;opacity:0.9;transition:all 0.15s;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
    btn.onmouseenter=function(){this.style.background='rgba(37,99,235,0.2)';this.style.color='#fff';};
    btn.onmouseleave=function(){this.style.background='#13131c';this.style.color='#7090e0';};
    btn.addEventListener('click', function(){ window.openPageTranslator(); });
    document.body.appendChild(btn);
  }

  document.addEventListener('keydown',function(e){if(e.altKey&&e.shiftKey&&e.code==='KeyT'){e.preventDefault();window.openPageTranslator();}});
  createTranslateBtn();
  window.openPageTranslator();
})();`
  },
  {
    id: 'space-summariser',
    name: 'AI Page Summariser',
    version: '1.1.0',
    description: 'Summarise any web page in one click.',
    author: 'Space Team',
    category: 'ai',
    icon: '✨',
    permissions: ['tabs', 'ai'],
    contentScript: `(function(){
  if(window.__spaceSummariser){
    if(window.openSummariser) window.openSummariser();
    return;
  }
  window.__spaceSummariser=true;
  function extractText(){
    var selectors=['article','[role="article"]','main','[role="main"]','.article-body','.post-content','.entry-content','.content','#content','#main'];
    var src=null;
    for(var i=0;i<selectors.length;i++){var el=document.querySelector(selectors[i]);if(el&&(el.innerText||'').trim().length>300){src=el;break;}}
    if(!src)src=document.body;
    var clone=src.cloneNode(true);
    clone.querySelectorAll('script,style,nav,header,footer,aside,iframe,form').forEach(function(n){try{n.remove();}catch(_){}});
    return (clone.innerText||clone.textContent||'').trim().slice(0,8000);
  }
  window.openSummariser = function(){
    var existing=document.getElementById('space-summariser-panel');
    if(existing){existing.remove();return;}
    var panel=document.createElement('div');
    panel.id='space-summariser-panel';
    panel.style.cssText='position:fixed;top:16px;right:16px;width:340px;max-height:80vh;background:#0d0d15;border:1px solid rgba(139,92,246,0.5);border-radius:12px;z-index:2147483647;display:flex;flex-direction:column;font-family:sans-serif;box-shadow:0 12px 48px rgba(0,0,0,0.6);overflow:hidden;';
    panel.innerHTML='<div style="background:#1a1a28;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:8px;"><span style="font-size:15px;">✨</span><span style="font-weight:600;font-size:13px;color:#e0e0ec;flex:1;letter-spacing:0.02em;">Page Summary</span><button id="space-summariser-close" style="background:none;border:none;color:#666680;cursor:pointer;font-size:14px;padding:2px 4px;">✕</button></div><div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;gap:6px;"><button id="space-summariser-btn-brief" style="flex:1;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:6px;color:#a78bfa;font-size:11.5px;font-weight:600;padding:6px;cursor:pointer;">Brief</button><button id="space-summariser-btn-bullets" style="flex:1;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:6px;color:#a78bfa;font-size:11.5px;font-weight:600;padding:6px;cursor:pointer;">Bullets</button><button id="space-summariser-btn-eli5" style="flex:1;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:6px;color:#a78bfa;font-size:11.5px;font-weight:600;padding:6px;cursor:pointer;">ELI5</button></div><div id="space-summariser-output" style="padding:16px 14px;font-size:13px;line-height:1.6;color:#c0c0d8;overflow-y:auto;flex:1;white-space:pre-wrap;">Select a summary type above to begin.</div><div id="space-summariser-status" style="padding:8px 14px;font-size:11px;color:#8888aa;background:#13131c;border-top:1px solid rgba(255,255,255,0.04);text-align:right;"></div>';
    document.body.appendChild(panel);
    var cb = document.getElementById('space-summariser-close');
    if(cb) cb.addEventListener('click', function(){ panel.remove(); });
    var btnB = document.getElementById('space-summariser-btn-brief');
    if(btnB) btnB.addEventListener('click', function(){ window.runSummary('brief'); });
    var btnBu = document.getElementById('space-summariser-btn-bullets');
    if(btnBu) btnBu.addEventListener('click', function(){ window.runSummary('bullets'); });
    var btnE = document.getElementById('space-summariser-btn-eli5');
    if(btnE) btnE.addEventListener('click', function(){ window.runSummary('eli5'); });
  }

  window.runSummary=function(type){
    var output=document.getElementById('space-summariser-output');
    var status=document.getElementById('space-summariser-status');
    if(!output)return;
    var text=extractText();
    if(!text||text.length<100){output.innerHTML='<span style="color:#f87171;">Not enough readable content on this page to summarise.</span>';return;}
    var api=window.spaceAPI;
    if(!api||!api.ai||!api.ai.chat){
      output.innerHTML='<span style="color:#f87171;">⚠ Load an AI model in the Space sidebar first.</span>';
      return;
    }
    var prompts={
      brief:'Provide a concise 2-3 sentence summary of the following web page content.',
      bullets:'Summarise the key points of the following web page content using bullet points.',
      eli5:'Explain the following web page content simply, as if I were 5 years old.'
    };
    var messages=[
      {role:'system',content:prompts[type]||prompts.brief},
      {role:'user',content:text}
    ];
    var reqId='summariser-'+Date.now();
    output.textContent='';
    if(status)status.textContent='Summarising...';
    var unsub=api.ai.onToken(function(data){
      if(data.requestId!==reqId)return;
      if(data.error){output.innerHTML+='<span style="color:#f87171;">Error: '+data.error+'</span>';if(status)status.textContent='';if(unsub)unsub();return;}
      if(data.token)output.textContent+=data.token;
      if(data.isFinal){if(status)status.textContent='Done';setTimeout(function(){if(status)status.textContent='';},2500);if(unsub)unsub();}
    });
    api.ai.chat(messages,{maxTokens:1024,temperature:0.5},reqId).catch(function(err){
      output.innerHTML='<span style="color:#f87171;">Summary failed: '+err.message+'</span>';
      if(status)status.textContent='';
    });
  };
  document.addEventListener('keydown',function(e){if(e.altKey&&e.shiftKey&&e.code==='KeyS'){e.preventDefault();window.openSummariser();}});
  window.openSummariser();
})();`
  }
];

let marketplaceData = [...BUILT_IN_EXTENSIONS];

export class ExtensionManager {
  private exts = new Map<string, InstalledExtension>();

  constructor() {
    this.loadState();
  }

  private loadState() {
    let raw = (extsStore.store as any).extensions;
    
    // First run initialization: if no extensions state exists, auto-install built-ins
    if (!raw) {
      raw = {};
      for (const ext of BUILT_IN_EXTENSIONS) {
        raw[ext.id] = { id: ext.id, enabled: true, pinned: true };
      }
      extsStore.set('extensions', raw);
    }

    for (const [id, data] of Object.entries(raw)) {
      this.exts.set(id, data as InstalledExtension);
    }
  }

  private saveState() {
    extsStore.set('extensions', Object.fromEntries(this.exts));
  }

  listMarketplace(): ExtensionManifest[] {
    return marketplaceData.map(ext => {
      const installed = this.exts.get(ext.id);
      return {
        ...ext,
        _installed: !!installed,
        _enabled: installed?.enabled ?? false,
      };
    });
  }

  listInstalled(): InstalledExtension[] {
    const installed = Array.from(this.exts.values());
    return installed.map(inst => {
      const mn = marketplaceData.find(m => m.id === inst.id);
      return { ...inst, ...mn };
    });
  }

  getInstalled(id: string): InstalledExtension | undefined {
    return this.exts.get(id);
  }

  install(id: string): InstalledExtension {
    if (this.exts.has(id)) return this.exts.get(id)!;
    const manifest = marketplaceData.find(m => m.id === id);
    if (!manifest) throw new Error(`Extension not found: ${id}`);

    const newExt: InstalledExtension = {
      id: manifest.id,
      enabled: true,
      pinned: true,
    };
    this.exts.set(id, newExt);
    this.saveState();
    console.log(`[ExtensionManager] Installed ${id}`);
    return newExt;
  }

  uninstall(id: string): void {
    if (this.exts.has(id)) {
      this.exts.delete(id);
      this.saveState();
      console.log(`[ExtensionManager] Uninstalled ${id}`);
    }
  }

  toggle(id: string, forceEnabled?: boolean): InstalledExtension | undefined {
    const ext = this.exts.get(id);
    if (!ext) return;
    ext.enabled = forceEnabled ?? !ext.enabled;
    this.saveState();
    return ext;
  }

  setPin(id: string, pinned: boolean): InstalledExtension | undefined {
    const ext = this.exts.get(id);
    if (!ext) return;
    ext.pinned = pinned;
    this.saveState();
    return ext;
  }

  getEnabledContentScripts(): { id: string; code: string }[] {
    const active = [];
    for (const [id, ext] of this.exts.entries()) {
      if (ext.enabled) {
        const manifest = marketplaceData.find(m => m.id === id);
        if (manifest?.contentScript) {
          active.push({ id, code: manifest.contentScript });
        }
      }
    }
    return active;
  }
}

export const extensionManager = new ExtensionManager();

