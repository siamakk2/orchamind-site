(function(){
  if(window.__shz)return; window.__shz=1;
  var cu=((document.querySelector('link[rel=canonical]')||{}).href)||location.href;
  var U=encodeURIComponent(cu);
  var ICON={
    fb:'<svg viewBox="0 0 24 24"><path d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z"/></svg>',
    li:'<svg viewBox="0 0 24 24"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM2.4 9.5h5.16V21H2.4V9.5zm7.5 0h4.95v1.57h.07c.69-1.24 2.38-2.55 4.9-2.55 5.24 0 6.2 3.45 6.2 7.93V21h-5.16v-5.62c0-1.34-.02-3.07-1.87-3.07-1.87 0-2.16 1.46-2.16 2.97V21H9.9V9.5z"/></svg>',
    ig:'<svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.43.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.43.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.43-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2zm0 1.8c-3.15 0-3.52.01-4.76.07-.9.04-1.39.19-1.71.32-.43.17-.74.37-1.06.69-.32.32-.52.63-.69 1.06-.13.32-.28.81-.32 1.71C3.21 8.48 3.2 8.85 3.2 12s.01 3.52.07 4.76c.04.9.19 1.39.32 1.71.17.43.37.74.69 1.06.32.32.63.52 1.06.69.32.13.81.28 1.71.32 1.24.06 1.61.07 4.76.07s3.52-.01 4.76-.07c.9-.04 1.39-.19 1.71-.32.43-.17.74-.37 1.06-.69.32-.32.52-.63.69-1.06.13-.32.28-.81.32-1.71.06-1.24.07-1.61.07-4.76s-.01-3.52-.07-4.76c-.04-.9-.19-1.39-.32-1.71a2.84 2.84 0 0 0-.69-1.06 2.84 2.84 0 0 0-1.06-.69c-.32-.13-.81-.28-1.71-.32C15.52 4.01 15.15 4 12 4zm0 3.06A4.94 4.94 0 1 0 12 16.94 4.94 4.94 0 0 0 12 7.06zm0 8.14A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4zm6.3-8.34a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0z"/></svg>',
    tk:'<svg viewBox="0 0 24 24"><path d="M16.6 5.82a4.28 4.28 0 0 1-1-.06 4.78 4.78 0 0 1-2.13-1.22A4.62 4.62 0 0 1 12.1 2h-3v12.3a2.6 2.6 0 0 1-2.6 2.5 2.6 2.6 0 0 1-2.6-2.6 2.6 2.6 0 0 1 3.4-2.48V8.6a5.66 5.66 0 0 0-4 1.05 5.62 5.62 0 0 0-2.1 3.8 5.7 5.7 0 0 0 1.36 4.16 5.7 5.7 0 0 0 4.18 1.9 5.7 5.7 0 0 0 5.6-5.7V8.06a7.66 7.66 0 0 0 4.27 1.3V6.36a4.3 4.3 0 0 1-1.42-.54z"/></svg>'
  };
  var css='.shz{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;padding:24px 16px;border-top:1px solid rgba(127,127,127,.18);font-family:inherit;}'
   +'.shz-l{font-size:13px;font-weight:600;opacity:.72;margin-right:2px;}'
   +'.shz a,.shz button{width:42px;height:42px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:none;cursor:pointer;padding:0;transition:transform .12s,box-shadow .12s;text-decoration:none;-webkit-tap-highlight-color:transparent;}'
   +'.shz a:hover,.shz button:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.28);}'
   +'.shz svg{width:20px;height:20px;fill:#fff;}'
   +'.shz .fb{background:#1877F2;}.shz .li{background:#0A66C2;}'
   +'.shz .ig{background:radial-gradient(circle at 30% 107%,#fdf497 0%,#fd5949 45%,#d6249f 70%,#285AEB 100%);}'
   +'.shz .tk{background:#010101;}'
   +'.shz-t{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:2147483600;opacity:0;pointer-events:none;transition:opacity .2s;font-family:inherit;}'
   +'.shz-t.on{opacity:1;}';
  var s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
  var bar=document.createElement('div'); bar.className='shz'; bar.setAttribute('aria-label','Share this page');
  bar.innerHTML='<span class="shz-l">Share this page</span>'
   +'<a class="fb" target="_blank" rel="noopener" aria-label="Share on Facebook" href="https://www.facebook.com/sharer/sharer.php?u='+U+'">'+ICON.fb+'</a>'
   +'<a class="li" target="_blank" rel="noopener" aria-label="Share on LinkedIn" href="https://www.linkedin.com/sharing/share-offsite/?url='+U+'">'+ICON.li+'</a>'
   +'<button class="ig" type="button" aria-label="Share to Instagram" onclick="__shzGo(\'Instagram\')">'+ICON.ig+'</button>'
   +'<button class="tk" type="button" aria-label="Share to TikTok" onclick="__shzGo(\'TikTok\')">'+ICON.tk+'</button>';
  function place(){
    var f=document.querySelector('footer')||document.querySelector('.footer,.site-footer,.foot');
    if(f&&f.parentNode){ f.parentNode.insertBefore(bar,f.nextSibling); } else { document.body.appendChild(bar); }
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',place); } else { place(); }
  window.__shzGo=function(net){
    if(navigator.share){ navigator.share({title:document.title,url:cu}).catch(function(){}); return; }
    var done=function(){ var t=document.createElement('div'); t.className='shz-t'; t.textContent='Link copied — open '+net+' and paste it'; document.body.appendChild(t); requestAnimationFrame(function(){t.classList.add('on');}); setTimeout(function(){t.classList.remove('on'); setTimeout(function(){if(t.parentNode)t.remove();},300);},2800); };
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(cu).then(done,done); }
    else { var ta=document.createElement('textarea'); ta.value=cu; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch(e){} ta.remove(); done(); }
  };
})();
