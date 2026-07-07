(function(){
  var self=document.currentScript;
  if(!self){var ss=document.getElementsByTagName('script');for(var i=ss.length-1;i>=0;i--){if((ss[i].src||'').indexOf('embed.js')>=0){self=ss[i];break;}}}
  var acct=(self&&(self.getAttribute('data-orchamind')||self.getAttribute('data-account')))||'';
  var accent=(self&&self.getAttribute('data-color'))||'#2D7FF9';
  var customTitle=self&&self.getAttribute('data-title');
  var mode=(self&&self.getAttribute('data-mode'))||'';
  var booking=(mode==='book'||mode==='booking');
  var heading=customTitle||(booking?'Book an appointment':'Request a free quote');
  var API='https://orchamind.com/api/lead-intake';
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  if(!acct){if(window.console)console.warn('Orchamind widget: add data-orchamind="your-account" to the script tag.');return;}
  if(!document.getElementById('om-lw-style')){
    var css='.om-lw{max-width:440px;margin:14px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a2230;box-sizing:border-box;line-height:1.5;}'
    +'.om-lw *{box-sizing:border-box;}'
    +'.om-lw-card{background:#fff;border:1px solid #e6ebf2;border-radius:14px;padding:22px;box-shadow:0 6px 24px rgba(20,32,54,.07);animation:om-in .35s ease both;}'
    +'@keyframes om-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}'
    +'.om-lw-brand{display:flex;align-items:center;gap:12px;margin:0 0 16px;}'
    +'.om-lw-logo{width:46px;height:46px;object-fit:contain;border-radius:10px;flex:none;background:#fff;border:1px solid #eef2f7;}'
    +'.om-lw-bt{min-width:0;}'
    +'.om-lw-h{font-size:18px;font-weight:700;margin:0;line-height:1.25;}'
    +'.om-lw-sub{font-size:12.5px;color:#66748a;margin:3px 0 0;}'
    +'.om-lw label{display:block;font-size:12px;font-weight:600;color:#42506a;margin:10px 0 4px;}'
    +'.om-lw input,.om-lw textarea{width:100%;border:1px solid #d8e0ea;border-radius:9px;padding:11px 12px;font-size:14px;font-family:inherit;color:#1a2230;background:#fff;}'
    +'.om-lw input:focus,.om-lw textarea:focus{outline:none;border-color:var(--om-accent);box-shadow:0 0 0 3px rgba(45,127,249,.14);}'
    +'.om-lw textarea{min-height:72px;resize:vertical;}'
    +'.om-lw-row{display:flex;gap:10px;}.om-lw-row>div{flex:1;}'
    +'.om-lw-btn{width:100%;margin-top:16px;border:none;border-radius:9px;padding:13px;font-size:15px;font-weight:700;color:#fff;background:var(--om-accent);cursor:pointer;transition:filter .15s;}'
    +'.om-lw-btn:hover{filter:brightness(1.07);}.om-lw-btn:disabled{opacity:.6;cursor:default;}'
    +'.om-lw-msg{font-size:13px;margin-top:11px;text-align:center;}'
    +'.om-lw-priv{font-size:11px;color:#8794a6;text-align:center;margin-top:10px;}'
    +'.om-lw-ok{text-align:center;padding:14px 8px 4px;}'
    +'.om-lw-ok .om-lw-check{width:52px;height:52px;border-radius:50%;background:#eaf7ef;color:#1c7a43;display:inline-flex;align-items:center;justify-content:center;font-size:27px;font-weight:700;margin-bottom:10px;}'
    +'.om-lw-ok h4{margin:0 0 4px;font-size:17px;color:#0A1628;}.om-lw-ok p{margin:0;font-size:13.5px;color:#66748a;}'
    +'.om-lw-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden;}'
    +'.om-lw-foot{font-size:11px;color:#9aa6b6;text-align:center;margin-top:14px;}'
    +'.om-lw-foot a{color:#9aa6b6;text-decoration:none;}'
    +'@media(max-width:420px){.om-lw-row{display:block;}}';
    var st=document.createElement('style');st.id='om-lw-style';st.textContent=css;document.head.appendChild(st);
  }
  var bookFields=booking?('<div class="om-lw-row"><div><label>Preferred date</label><input name="pdate" type="date"></div><div><label>Preferred time</label><select name="ptime" style="width:100%;border:1px solid #d8e0ea;border-radius:9px;padding:11px 12px;font-size:14px;background:#fff;color:#1a2230;"><option value="">Any time</option><option>Morning</option><option>Afternoon</option><option>Evening</option></select></div></div>'):'';
  var wrap=document.createElement('div');wrap.className='om-lw';wrap.style.setProperty('--om-accent',accent);
  wrap.innerHTML='<div class="om-lw-card">'
    +'<div class="om-lw-brand"><img class="om-lw-logo" data-om-logo alt="" style="display:none;">'
    +'<div class="om-lw-bt"><div class="om-lw-h" data-om-h>'+esc(heading)+'</div>'
    +'<div class="om-lw-sub" data-om-sub>'+(booking?'Pick a time that works and we will confirm your appointment.':'Fill this out and we will get right back to you.')+'</div></div></div>'
    +'<form data-om-form><label>Name *</label><input name="name" type="text" autocomplete="name" required>'
    +'<div class="om-lw-row"><div><label>Phone</label><input name="phone" type="tel" autocomplete="tel"></div>'
    +'<div><label>Email</label><input name="email" type="email" autocomplete="email"></div></div>'
    +'<label>What do you need?</label><input name="service" type="text" placeholder="e.g. Kitchen remodel, roof repair">'
    +bookFields
    +'<label>Details</label><textarea name="notes" placeholder="Tell us a bit about the project"></textarea>'
    +'<input class="om-lw-hp" tabindex="-1" autocomplete="off" name="hp" aria-hidden="true">'
    +'<button class="om-lw-btn" type="submit">'+(booking?'Request my appointment':'Send my request')+'</button>'
    +'<div class="om-lw-msg" data-om-msg></div>'
    +'<div class="om-lw-priv">\u{1F512} Your details go straight to us \u2014 never shared.</div></form>'
    +'<div class="om-lw-foot">Powered by <a href="https://orchamind.com" target="_blank" rel="noopener">Orchamind</a></div></div>';
  (self.parentNode||document.body).insertBefore(wrap,self.nextSibling);
  var form=wrap.querySelector('[data-om-form]');var msg=wrap.querySelector('[data-om-msg]');var card=wrap.querySelector('.om-lw-card');
  var company='';
  try{fetch(API+'?c='+encodeURIComponent(acct)).then(function(r){return r.json();}).then(function(d){
    if(!d||!d.ok)return;
    if(d.logo){var lg=wrap.querySelector('[data-om-logo]');if(lg){lg.onerror=function(){lg.style.display='none';};lg.src=d.logo;lg.style.display='block';}}
    if(d.company){company=d.company;if(!customTitle){var hh=wrap.querySelector('[data-om-h]');if(hh)hh.textContent=(booking?'Book with ':'Request a quote from ')+d.company;}}
  }).catch(function(){});}catch(e){}
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var btn=form.querySelector('.om-lw-btn');
    var fd={};['name','phone','email','service','notes','hp'].forEach(function(k){var el=form.querySelector('[name="'+k+'"]');fd[k]=el?el.value.trim():'';});
    if(!fd.name){msg.style.color='#c0392b';msg.textContent='Please enter your name.';return;}
    fd.c=acct;
    if(booking){var _pd=(form.querySelector('[name="pdate"]')||{}).value||'';var _pt=(form.querySelector('[name="ptime"]')||{}).value||'';var _pref=[_pd,_pt].filter(Boolean).join(' ');if(_pref){fd.notes='Requested time: '+_pref+(fd.notes?('. '+fd.notes):'');}fd.service=(fd.service||'Appointment')+' [Booking]';}
    btn.disabled=true;var old=btn.textContent;btn.textContent='Sending...';msg.textContent='';
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fd)}).then(function(r){return r.json();}).then(function(d){
      if(d&&d.ok){card.innerHTML='<div class="om-lw-ok"><div class="om-lw-check">\u2713</div><h4>Thanks, '+esc(fd.name.split(' ')[0])+'!</h4><p>'+(booking?'Your appointment request is in':'Your request is in')+(company?(' with '+esc(company)):'')+' \u2014 we will be in touch shortly.</p></div><div class="om-lw-foot">Powered by <a href="https://orchamind.com" target="_blank" rel="noopener">Orchamind</a></div>';}
      else{btn.disabled=false;btn.textContent=old;msg.style.color='#c0392b';msg.textContent=(d&&d.error)||'Something went wrong. Please try again.';}
    }).catch(function(){btn.disabled=false;btn.textContent=old;msg.style.color='#c0392b';msg.textContent='Network error. Please try again.';});
  });
})();
