/* ============================================================================
   consent.js — cookie & tracking consent for Siamak Kalhor Consulting
   Portable: drop into any site, edit CONFIG, load with <script defer src>.

   Requires the head snippet (consent-head-snippet.html) to run BEFORE
   gtag.js so Consent Mode defaults are queued ahead of any measurement.

   Public API:
     SKConsent.open()   open the preferences panel
     SKConsent.get()    -> {analytics:bool, functional:bool, ads:bool, ts, v}
     SKConsent.reset()  clear stored choice and re-show the banner
     window.addEventListener('sk:consent', e => e.detail)  // on every change
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    key: 'sk_consent_v1',
    version: 1,
    rememberDays: 180,     // re-ask after this long
    policyUrl: '/privacy.html',
    showAds: false,        // no ad tags on this site; flip to true if Google Ads is added
    // Set true to require opt-in everywhere (nothing measured until Accept).
    // Set false to opt-in in EEA/UK/CH and notice-with-opt-out elsewhere.
    strictOptIn: false,

    // Palette. Every site has its own, and three of them are light-themed, so
    // this is explicit rather than reading CSS vars that may not exist.
    theme: {
      bg: '#FFFFFF', panelBg: '#F7F9FC', card: '#F7F9FC', track: '#E1E8F0',
      line: '#E1E8F0', lineHi: '#C6D2E0',
      text: '#0A1628', muted: '#3D4C5C', dim: '#5A6B7D',
      accent: '#2871DE', accentHi: '#205AB2', accentInk: '#FFFFFF',
      accentFade: 'rgba(40,113,222,.35)', accentWash: 'rgba(40,113,222,.14)',
      shadow: 'rgba(10,22,40,.16)',
      display: "inherit", mono: 'ui-monospace,monospace'
    }
  };

  var EEA = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
             'IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES',
             'SE','IS','LI','NO','GB','CH'];

  var W = window, D = document;
  W.dataLayer = W.dataLayer || [];
  function gtag() { W.dataLayer.push(arguments); }

  /* ---------- storage ------------------------------------------------- */

  function read() {
    try {
      var raw = localStorage.getItem(CONFIG.key);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || v.v !== CONFIG.version) return null;
      if (Date.now() - v.ts > CONFIG.rememberDays * 864e5) return null;
      return v;
    } catch (e) { return null; }
  }

  function write(p) {
    var v = { v: CONFIG.version, ts: Date.now(),
              analytics: !!p.analytics, functional: !!p.functional, ads: !!p.ads };
    try { localStorage.setItem(CONFIG.key, JSON.stringify(v)); } catch (e) {}
    // Mirror to a cookie so edge/server code can read the choice if ever needed.
    try {
      D.cookie = 'sk_consent=' + (v.analytics ? 'a' : '-') + (v.functional ? 'f' : '-') +
                 (v.ads ? 'd' : '-') + '; path=/; max-age=' + (CONFIG.rememberDays * 86400) +
                 '; samesite=lax' + (location.protocol === 'https:' ? '; secure' : '');
    } catch (e) {}
    return v;
  }

  /* ---------- consent signals ----------------------------------------- */

  function signals(p) {
    return {
      security_storage: 'granted',
      analytics_storage: p.analytics ? 'granted' : 'denied',
      functionality_storage: p.functional ? 'granted' : 'denied',
      personalization_storage: p.functional ? 'granted' : 'denied',
      ad_storage: p.ads ? 'granted' : 'denied',
      ad_user_data: p.ads ? 'granted' : 'denied',
      ad_personalization: p.ads ? 'granted' : 'denied'
    };
  }

  function apply(p, persist) {
    var v = persist ? write(p) : p;
    gtag('consent', 'update', signals(v));
    unlock(v);
    W.dispatchEvent(new CustomEvent('sk:consent', { detail: v }));
    return v;
  }

  /* ---------- gated third-party scripts -------------------------------
     Mark any non-essential embed like this and it will only run on consent:
       <script type="text/plain" data-consent="functional"
               data-src="https://unpkg.com/@elevenlabs/convai-widget-embed"></script>
  --------------------------------------------------------------------- */

  function unlock(v) {
    var nodes = D.querySelectorAll('script[type="text/plain"][data-consent]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], cat = n.getAttribute('data-consent');
      if (!v[cat]) continue;
      var s = D.createElement('script');
      for (var j = 0; j < n.attributes.length; j++) {
        var a = n.attributes[j];
        if (a.name === 'type' || a.name === 'data-consent' || a.name === 'data-src') continue;
        s.setAttribute(a.name, a.value);
      }
      if (n.getAttribute('data-src')) { s.src = n.getAttribute('data-src'); s.async = true; }
      else { s.textContent = n.textContent; }
      n.parentNode.replaceChild(s, n);
    }
  }

  /* ---------- styles --------------------------------------------------- */

  var T = CONFIG.theme;

  var CSS = [
    '.skc,.skc *{box-sizing:border-box}',
    '.skc{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;',
      'font-family:inherit;',
      'background:'+T.bg+';color:'+T.muted+';',
      'border-top:1px solid '+T.line+';',
      'box-shadow:0 -24px 60px '+T.shadow+';',
      'transform:translateY(100%);transition:transform .32s cubic-bezier(.2,.7,.3,1)}',
    '.skc[data-show="1"]{transform:translateY(0)}',
    '.skc-in{max-width:1180px;margin:0 auto;padding:20px 24px 22px;',
      'display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap}',
    '.skc-copy{flex:1 1 420px;min-width:0}',
    '.skc-eyebrow{font-family:'+T.mono+';font-size:10px;',
      'letter-spacing:.16em;text-transform:uppercase;color:'+T.accent+';',
      'margin:0 0 8px;display:flex;align-items:center;gap:9px}',
    '.skc-eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;',
      'background:'+T.accent+';box-shadow:0 0 10px '+T.accent+'}',
    '.skc-h{font-family:'+T.display+';font-size:16px;',
      'font-weight:600;color:'+T.text+';margin:0 0 6px;letter-spacing:-.01em}',
    '.skc-p{font-size:13.5px;line-height:1.6;margin:0;color:'+T.dim+'}',
    '.skc-p a{color:'+T.accent+';text-decoration:none;border-bottom:1px solid '+T.accentFade+'}',
    '.skc-p a:hover{border-bottom-color:'+T.accent+'}',
    '.skc-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;flex:0 0 auto;padding-top:4px}',
    '.skc-b{font-family:inherit;font-size:13px;font-weight:600;',
      'padding:10px 18px;border-radius:6px;border:1px solid '+T.line+';',
      'background:transparent;color:'+T.muted+';cursor:pointer;',
      'transition:border-color .18s,color .18s,background .18s;white-space:nowrap}',
    '.skc-b:hover{border-color:'+T.lineHi+';color:'+T.text+'}',
    '.skc-b--primary{background:'+T.accent+';border-color:'+T.accent+';color:'+T.accentInk+'}',
    '.skc-b--primary:hover{background:'+T.accentHi+';border-color:'+T.accentHi+';color:'+T.accentInk+'}',
    '.skc-b--ghost{border-color:transparent;color:'+T.dim+';padding:10px 8px}',
    '.skc-b--ghost:hover{color:'+T.accent+'}',
    '.skc :focus-visible,.skc-b:focus-visible{outline:2px solid '+T.accent+';outline-offset:2px}',
    /* preferences panel */
    '.skc-panel{border-top:1px solid '+T.line+';background:'+T.panelBg+';',
      'max-height:0;overflow:hidden;transition:max-height .3s ease}',
    '.skc-panel[data-open="1"]{max-height:640px;overflow:auto}',
    '.skc-panel-in{max-width:1180px;margin:0 auto;padding:18px 24px 22px;',
      'display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}',
    '.skc-cat{border:1px solid '+T.line+';border-radius:8px;padding:14px 16px;',
      'background:'+T.card+';display:flex;gap:13px;align-items:flex-start}',
    '.skc-cat h4{font-family:'+T.mono+';font-size:10.5px;letter-spacing:.13em;',
      'text-transform:uppercase;color:'+T.text+';margin:1px 0 5px;font-weight:600}',
    '.skc-cat p{font-size:12.5px;line-height:1.55;margin:0;color:'+T.dim+'}',
    '.skc-cat .skc-lock{font-family:'+T.mono+';font-size:10px;letter-spacing:.1em;',
      'color:'+T.accent+';flex:0 0 auto;padding-top:2px;text-transform:uppercase}',
    /* switch */
    '.skc-sw{flex:0 0 auto;position:relative;width:38px;height:21px;margin-top:1px}',
    '.skc-sw input{position:absolute;inset:0;opacity:0;margin:0;width:100%;height:100%;cursor:pointer}',
    '.skc-sw span{position:absolute;inset:0;border-radius:999px;background:'+T.track+';',
      'border:1px solid '+T.line+';transition:background .2s,border-color .2s;pointer-events:none}',
    '.skc-sw span::after{content:"";position:absolute;top:3px;left:3px;width:13px;height:13px;',
      'border-radius:50%;background:'+T.dim+';transition:transform .2s,background .2s}',
    '.skc-sw input:checked+span{background:'+T.accentWash+';border-color:'+T.accent+'}',
    '.skc-sw input:checked+span::after{transform:translateX(17px);background:'+T.accent+'}',
    '.skc-sw input:focus-visible+span{outline:2px solid '+T.accent+';outline-offset:2px}',
    '.skc-panel-foot{grid-column:1/-1;display:flex;gap:10px;justify-content:flex-end;',
      'flex-wrap:wrap;padding-top:4px}',
    /* RTL (fa). Flex and text direction are inherited from <html dir>, but the
       switch knob is transform-based and has to be mirrored explicitly. */
    '[dir="rtl"] .skc-sw input:checked+span::after{transform:translateX(-17px)}',
    '[dir="rtl"] .skc-panel-foot{justify-content:flex-start}',
    '[dir="rtl"] .skc-eyebrow{letter-spacing:normal}',
    '[dir="rtl"] .skc-cat h4{letter-spacing:normal}',
    '[dir="rtl"] .skc-lock{letter-spacing:normal}',
    '@media(max-width:720px){',
      '.skc-in{padding:16px 18px 18px;gap:16px}',
      '.skc-acts{width:100%}.skc-b{flex:1 1 auto;text-align:center}',
      '.skc-panel-in{padding:14px 18px 18px}}',
    '@media(prefers-reduced-motion:reduce){.skc,.skc-panel,.skc-sw span::after{transition:none}}'
  ].join('');

  /* ---------- markup --------------------------------------------------- */


  /* ---------- copy ------------------------------------------------------
     en, es, fa, hy. Anything else falls back to English.
     The banner inherits the page's own font stack (Vazirmatn on /fa,
     Noto Sans Armenian on /hy), so scripts render in their proper face.
  --------------------------------------------------------------------- */

  var STRINGS = {
    en: {
      eyebrow: 'Your data, your call',
      title: 'Choose what this site measures',
      body: 'Essential cookies keep the site running. Analytics and the AI assistant are optional. You can change this at any time from the footer. Details in the {a}privacy notice{/a}.',
      customize: 'Customize', hide: 'Hide options',
      reject: 'Reject optional', accept: 'Accept all', save: 'Save my choices',
      always: 'Always', link: 'Cookie preferences',
      c_essential: 'Essential',
      d_essential: 'Security, load balancing and abuse prevention. Needed for the site to work, so these cannot be switched off.',
      c_analytics: 'Analytics',
      d_analytics: 'Google Analytics records which pages you viewed, roughly where you are, your device and how you arrived.',
      c_functional: 'AI assistant',
      d_functional: 'Loads the voice advisor and remembers your place in it. Off means the assistant will not appear.',
      c_ads: 'Advertising',
      d_ads: 'Advertising and remarketing identifiers. Nothing on this site uses them today.'
    },
    es: {
      eyebrow: 'Tus datos, tu decision',
      title: 'Elige que mide este sitio',
      body: 'Las cookies esenciales mantienen el sitio en funcionamiento. La analitica y el asistente de IA son opcionales. Puedes cambiar esto cuando quieras desde el pie de pagina. Mas detalles en el {a}aviso de privacidad{/a}.',
      customize: 'Personalizar', hide: 'Ocultar opciones',
      reject: 'Rechazar opcionales', accept: 'Aceptar todo', save: 'Guardar mis preferencias',
      always: 'Siempre', link: 'Preferencias de cookies',
      c_essential: 'Esenciales',
      d_essential: 'Seguridad, balanceo de carga y prevencion de abuso. Son necesarias para que el sitio funcione, por eso no se pueden desactivar.',
      c_analytics: 'Analitica',
      d_analytics: 'Google Analytics registra que paginas viste, tu ubicacion aproximada, tu dispositivo y como llegaste.',
      c_functional: 'Asistente de IA',
      d_functional: 'Carga el asesor de voz y recuerda donde lo dejaste. Desactivado, el asistente no aparecera.',
      c_ads: 'Publicidad',
      d_ads: 'Identificadores de publicidad y remarketing. Hoy nada en este sitio los utiliza.'
    },
    fa: {
      eyebrow: 'داده‌های شما، انتخاب شما',
      title: 'انتخاب کنید این سایت چه چیزی را اندازه می‌گیرد',
      body: 'کوکی‌های ضروری سایت را در حال کار نگه می‌دارند. تحلیل آماری و دستیار هوش مصنوعی اختیاری هستند. هر زمان بخواهید می‌توانید این انتخاب را از پایین صفحه تغییر دهید. جزئیات در {a}سیاست حریم خصوصی{/a} (به زبان انگلیسی).',
      customize: 'تنظیم دلخواه', hide: 'بستن گزینه‌ها',
      reject: 'رد موارد اختیاری', accept: 'پذیرش همه', save: 'ذخیرهٔ انتخاب‌ها',
      always: 'همیشه', link: 'تنظیمات کوکی',
      c_essential: 'ضروری',
      d_essential: 'امنیت، توزیع بار و جلوگیری از سوءاستفاده. برای کارکرد سایت لازم‌اند و به همین دلیل قابل خاموش‌کردن نیستند.',
      c_analytics: 'تحلیل آماری',
      d_analytics: 'گوگل آنالیتیکس ثبت می‌کند چه صفحه‌هایی را دیده‌اید، تقریباً کجا هستید، با چه دستگاهی و از چه راهی وارد شده‌اید.',
      c_functional: 'دستیار هوش مصنوعی',
      d_functional: 'مشاور صوتی را بارگذاری می‌کند و جای شما را در گفت‌وگو به یاد می‌سپارد. اگر خاموش باشد، دستیار نمایش داده نمی‌شود.',
      c_ads: 'تبلیغات',
      d_ads: 'شناسه‌های تبلیغاتی و بازاریابی مجدد. در حال حاضر هیچ بخشی از این سایت از آن‌ها استفاده نمی‌کند.'
    },
    hy: {
      eyebrow: 'Ձեր տվյալները, ձեր ընտրությունը',
      title: 'Ընտրեք, թե ինչ է չափում այս կայքը',
      body: 'Անհրաժեշտ քուքիներն ապահովում են կայքի աշխատանքը։ Վերլուծությունը և արհեստական բանականության օգնականը կամընտիր են։ Կարող եք ցանկացած պահի փոխել ընտրությունը էջի ստորոտից։ Մանրամասները՝ {a}գաղտնիության քաղաքականության{/a} մեջ (անգլերեն)։',
      customize: 'Կարգավորել', hide: 'Փակել ընտրանքները',
      reject: 'Մերժել կամընտիրները', accept: 'Ընդունել բոլորը', save: 'Պահպանել ընտրությունս',
      always: 'Միշտ', link: 'Քուքիների կարգավորումներ',
      c_essential: 'Անհրաժեշտ',
      d_essential: 'Անվտանգություն, բեռնվածության բաշխում և չարաշահման կանխարգելում։ Անհրաժեշտ են կայքի աշխատանքի համար, ուստի չեն կարող անջատվել։',
      c_analytics: 'Վերլուծություն',
      d_analytics: 'Google Analytics-ը գրանցում է, թե որ էջերն եք դիտել, մոտավորապես որտեղ եք գտնվում, ձեր սարքը և ինչպես եք հասել կայք։',
      c_functional: 'AI օգնական',
      d_functional: 'Բեռնում է ձայնային խորհրդատուին և հիշում ձեր տեղը զրույցում։ Անջատված վիճակում օգնականը չի հայտնվի։',
      c_ads: 'Գովազդ',
      d_ads: 'Գովազդային և վերաշուկայավարման նույնացուցիչներ։ Այս կայքում ներկայում ոչինչ չի օգտագործում դրանք։'
    }
  };

  var LANG = (function () {
    var l = (D.documentElement.getAttribute('lang') || 'en').toLowerCase().split('-')[0];
    return STRINGS[l] ? l : 'en';
  })();

  function t(k) { return STRINGS[LANG][k] || STRINGS.en[k] || ''; }

  var CATS = [
    { id: 'essential',  locked: true },
    { id: 'analytics' },
    { id: 'functional' },
    { id: 'ads' }
  ];

  var root, panel;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function catHTML(c, on) {
    var name = t('c_' + c.id), desc = t('d_' + c.id);
    if (c.locked) {
      return '<div class="skc-cat"><span class="skc-lock">' + esc(t('always')) + '</span><div>' +
             '<h4>' + esc(name) + '</h4><p>' + esc(desc) + '</p></div></div>';
    }
    return '<div class="skc-cat"><label class="skc-sw">' +
           '<input type="checkbox" data-cat="' + c.id + '"' + (on ? ' checked' : '') +
           ' aria-label="' + esc(name) + '"><span></span></label><div>' +
           '<h4>' + esc(name) + '</h4><p>' + esc(desc) + '</p></div></div>';
  }

  function build(current) {
    var st = D.createElement('style'); st.textContent = CSS; D.head.appendChild(st);

    root = D.createElement('div');
    root.className = 'skc';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Cookie and tracking choices');

    var cats = CATS.filter(function (c) { return c.id !== 'ads' || CONFIG.showAds; });

    var body = esc(t('body'));
    body = CONFIG.policyUrl
      ? body.replace('{a}', '<a href="' + esc(CONFIG.policyUrl) + '">').replace('{/a}', '</a>')
      : body.replace(/\s*[^.。։]*\{a\}.*?\{\/a\}[^.。։]*[.。։]/, '');

    root.innerHTML =
      '<div class="skc-in">' +
        '<div class="skc-copy">' +
          '<p class="skc-eyebrow">' + esc(t('eyebrow')) + '</p>' +
          '<h2 class="skc-h">' + esc(t('title')) + '</h2>' +
          '<p class="skc-p">' + body + '</p>' +
        '</div>' +
        '<div class="skc-acts">' +
          '<button type="button" class="skc-b skc-b--ghost" data-act="toggle" aria-expanded="false" aria-controls="skc-panel">' + esc(t('customize')) + '</button>' +
          '<button type="button" class="skc-b" data-act="reject">' + esc(t('reject')) + '</button>' +
          '<button type="button" class="skc-b skc-b--primary" data-act="accept">' + esc(t('accept')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="skc-panel" id="skc-panel"><div class="skc-panel-in">' +
        cats.map(function (c) { return catHTML(c, !!current[c.id]); }).join('') +
        '<div class="skc-panel-foot">' +
          '<button type="button" class="skc-b skc-b--primary" data-act="save">' + esc(t('save')) + '</button>' +
        '</div>' +
      '</div></div>';

    D.body.appendChild(root);
    panel = root.querySelector('.skc-panel');
    root.addEventListener('click', onClick);
    D.addEventListener('keydown', onKey);
    return root;
  }

  function onClick(e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'toggle') return togglePanel();
    if (act === 'accept') return finish({ analytics: true, functional: true, ads: CONFIG.showAds });
    if (act === 'reject') return finish({ analytics: false, functional: false, ads: false });
    if (act === 'save') {
      var p = { analytics: false, functional: false, ads: false };
      root.querySelectorAll('input[data-cat]').forEach(function (i) {
        p[i.getAttribute('data-cat')] = i.checked;
      });
      return finish(p);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape' && panel && panel.getAttribute('data-open') === '1') togglePanel();
  }

  function togglePanel(force) {
    var open = force !== undefined ? force : panel.getAttribute('data-open') !== '1';
    panel.setAttribute('data-open', open ? '1' : '0');
    // NB: name this 'btn', not 't' — 't' is the translation helper in this scope.
    var btn = root.querySelector('[data-act="toggle"]');
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? t('hide') : t('customize');
    }
  }

  function show() {
    requestAnimationFrame(function () { root.setAttribute('data-show', '1'); });
  }

  function hide() {
    root.setAttribute('data-show', '0');
    togglePanel(false);
    setTimeout(function () { if (root && root.parentNode) root.parentNode.removeChild(root); root = null; }, 400);
  }

  function finish(p) { apply(p, true); hide(); }

  /* ---------- footer link ---------------------------------------------- */

  function wireFooterLinks() {
    D.addEventListener('click', function (e) {
      var a = e.target.closest('[data-sk-consent-open], a[href="#cookie-preferences"]');
      if (!a) return;
      e.preventDefault();
      API.open();
    });
  }

  // Pages whose footer markup has no hand-placed link get one added here, so
  // every page keeps a way back into the choice.
  function ensureEntryPoint() {
    if (D.querySelector('[data-sk-consent-open], a[href="#cookie-preferences"]')) return;
    var host = D.querySelector('footer') || D.body;
    var a = D.createElement('a');
    a.href = '#cookie-preferences';
    a.setAttribute('data-sk-consent-open', '');
    a.textContent = t('link');
    a.style.cssText = 'display:block;text-align:center;padding:14px 16px;font-family:' +
      'var(--body,Inter,system-ui,sans-serif);font-size:12px;letter-spacing:.02em;' +
      'color:var(--muted-dim,#aab6c4);text-decoration:none;opacity:.85';
    a.addEventListener('mouseenter', function () { a.style.color = 'var(--cyan,#2dd4ff)'; });
    a.addEventListener('mouseleave', function () { a.style.color = 'var(--muted-dim,#aab6c4)'; });
    host.appendChild(a);
  }

  /* ---------- public API ------------------------------------------------ */

  var API = {
    get: function () { return read() || { analytics: false, functional: false, ads: false, ts: 0, v: CONFIG.version }; },
    open: function () {
      if (root) { togglePanel(true); return; }
      build(API.get()); show(); togglePanel(true);
    },
    reset: function () {
      try { localStorage.removeItem(CONFIG.key); } catch (e) {}
      D.cookie = 'sk_consent=; path=/; max-age=0';
      if (root) hide();
      setTimeout(function () { build({ analytics: false, functional: false, ads: false }); show(); }, 450);
    },
    config: CONFIG
  };
  W.SKConsent = API;
  // Back-compat: tableops/ResBizAI footer calls rbConsentReopen() inline.
  if (!W.rbConsentReopen) W.rbConsentReopen = function () { API.open(); };

  /* ---------- boot ------------------------------------------------------ */

  function boot() {
    wireFooterLinks();
    ensureEntryPoint();
    var saved = read();
    if (saved) { apply(saved, false); return; }   // returning visitor, no banner
    // No stored choice. In non-strict mode the head snippet already granted
    // analytics outside the EEA/UK/CH, so the banner is notice-plus-opt-out there.
    build({ analytics: !CONFIG.strictOptIn, functional: false, ads: false });
    show();
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
