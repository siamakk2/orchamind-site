(function(){
  var self=document.currentScript;
  if(!self){var ss=document.getElementsByTagName('script');for(var i=ss.length-1;i>=0;i--){if((ss[i].src||'').indexOf('embed.js')>=0){self=ss[i];break;}}}
  var acct=(self&&(self.getAttribute('data-orchamind')||self.getAttribute('data-account')))||'';
  var accent=(self&&self.getAttribute('data-color'))||'#2D7FF9';
  var heading=(self&&self.getAttribute('data-title'))||'Request a free quote';
  var API='https://orchamind.com/api/lead-intake';
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  if(!acct){if(window.console)console.warn('Orchamind widget: add data-orchamind="your-account" to the script tag.');return;}
  if(!document.getElementById('om-lw-style')){
    var css='.om-lw{max-width:440px;margin:14px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a2230;box-sizing:border-box;line-height:1.5;}'
    +'.om-lw *{box-sizing:border-box;}'
    +'.om-lw-card{background:#fff;border:1px solid #e6ebf2;border-radius:14px;padding:22px;box-shadow:0 6px 24px rgba(20,32,54,.07);}'
    +'.om-lw-h{font-size:19px;font-weight:700;margin:0 0 4px;}'
    +'.om-lw-sub{font-size:13px;color:#66748a;margin:0 0 15px;}'
    +'.om-lw label{display:block;font-size:12px;font-weight:600;color:#42506a;margin:10px 0 4px;}'
    +'.om-lw input,.om-lw textarea{width:100%;border:1px solid #d8e0ea;border-radius:9px;padding:11px 12px;font-size:14px;font-family:inherit;color:#1a2230;background:#fff;}'
    +'.om-lw input:focus,.om-lw textarea:focus{outline:none;border-color:var(--om-accent);box-shadow:0 0 0 3px rgba(45,127,249,.14);}'
    +'.om-lw textarea{min-height:72px;resize:vertical;}'
    +'.om-lw-row{display:flex;gap:10px;}.om-lw-row>div{flex:1;}'
    +'.om-lw-btn{width:100%;margin-top:16px;border:none;border-radius:9px;padding:13px;font-size:15px;font-weight:700;color:#fff;background:var(--om-accent);cursor:pointer;}'
    +'.om-lw-btn:disabled{opacity:.6;cursor:default;}'
    +'.om-lw-msg{font-size:13px;margin-top:11px;text-align:center;}'
    +'.om-lw-ok{background:#eaf7ef;color:#1c7a43;border-radius:11px;padding:20px;text-align:center;font-size:14.5px;font-weight:600;}'
    +'.om-lw-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden;}'
    +'.om-lw-foot{font-size:11px;color:#9aa6b6;text-align:center;margin-top:12px;}'
    +'.om-lw-foot a{color:#9aa6b6;text-decoration:none;}'
    +'@media(max-width:420px){.om-lw-row{display:block;}}';
    var st=document.createElement('style');st.id='om-lw-style';st.textContent=css;document.head.appendChild(st);
  }
  var wrap=document.createElement('div');wrap.className='om-lw';wrap.style.setProperty('--om-accent',accent);
  wrap.innerHTML='<div class="om-lw-card"><div class="om-lw-h" data-om-h>'+esc(heading)+'</div>'
    +'<div class="om-lw-sub">Fill this out and we will get right back to you.</div>'
    +'<form data-om-form><label>Name *</label><input name="name" type="text" autocomplete="name" required>'
    +'<div class="om-lw-row"><div><label>Phone</label><input name="phone" type="tel" autocomplete="tel"></div>'
    +'<div><label>Email</label><input name="email" type="email" autocomplete="email"></div></div>'
    +'<label>What do you need?</label><input name="service" type="text" placeholder="e.g. Kitchen remodel, roof repair">'
    +'<label>Details</label><textarea name="notes" placeholder="Tell us a bit about the project"></textarea>'
    +'<input class="om-lw-hp" tabindex="-1" autocomplete="off" name="hp" aria-hidden="true">'
    +'<button class="om-lw-btn" type="submit">Send my request</button>'
    +'<div class="om-lw-msg" data-om-msg></div></form>'
    +'<div class="om-lw-foot">Powered by <a href="https://orchamind.com" target="_blank" rel="noopener">Orchamind</a></div></div>';
  (self.parentNode||document.body).insertBefore(wrap,self.nextSibling);
  var form=wrap.querySelector('[data-om-form]');var msg=wrap.querySelector('[data-om-msg]');var card=wrap.querySelector('.om-lw-card');
  try{fetch(API+'?c='+encodeURIComponent(acct)).then(function(r){return r.json();}).then(function(d){if(d&&d.ok&&d.company){var hh=wrap.querySelector('[data-om-h]');if(hh)hh.textContent='Request a quote from '+d.company;}}).catch(function(){});}catch(e){}
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var btn=form.querySelector('.om-lw-btn');
    var fd={};['name','phone','email','service','notes','hp'].forEach(function(k){var el=form.querySelector('[name="'+k+'"]');fd[k]=el?el.value.trim():'';});
    if(!fd.name){msg.style.color='#c0392b';msg.textContent='Please enter your name.';return;}
    fd.c=acct;
    btn.disabled=true;var old=btn.textContent;btn.textContent='Sending...';msg.textContent='';
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fd)}).then(function(r){return r.json();}).then(function(d){
      if(d&&d.ok){card.innerHTML='<div class="om-lw-ok">\u2713 Thanks, '+esc(fd.name.split(' ')[0])+'! Your request is in \u2014 we will be in touch shortly.</div><div class="om-lw-foot">Powered by <a href="https://orchamind.com" target="_blank" rel="noopener">Orchamind</a></div>';}
      else{btn.disabled=false;btn.textContent=old;msg.style.color='#c0392b';msg.textContent=(d&&d.error)||'Something went wrong. Please try again.';}
    }).catch(function(){btn.disabled=false;btn.textContent=old;msg.style.color='#c0392b';msg.textContent='Network error. Please try again.';});
  });
})();
