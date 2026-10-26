/* Orchamind shared header behaviour: phone menu sheet, drop-downs, Escape,
 * and no page scrolling behind the open menu. Markup comes from
 * scripts/build-chrome.py. */
(function () {
  var root = document.getElementById('omh');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');
  var toggle = root.querySelector('.omh-toggle');
  var drops = Array.prototype.slice.call(root.querySelectorAll('.omh-dd'));
  var html = document.documentElement;
  function closeDrops(except) {
    drops.forEach(function (d) { if (d !== except) { d.classList.remove('open'); d.querySelector('button').setAttribute('aria-expanded', 'false'); } });
  }
  function setOpen(open) {
    root.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    html.classList.toggle('omh-lock', open);
    if (!open) closeDrops();
  }
  if (toggle) toggle.addEventListener('click', function () { setOpen(!root.classList.contains('open')); });
  drops.forEach(function (d) {
    var btn = d.querySelector('button');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !d.classList.contains('open');
      closeDrops(d);
      d.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
  document.addEventListener('click', function (e) { if (!root.contains(e.target)) closeDrops(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (root.classList.contains('open')) { setOpen(false); toggle.focus(); } else closeDrops(); }
  });
  // Following a link inside the sheet (including same-page anchors) closes it.
  root.querySelectorAll('.omh-nav a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
  // Rotating a tablet into desktop width with the sheet open must not leave the page locked.
  var mq = window.matchMedia('(min-width: 1101px)');
  var onWide = function () { if (mq.matches) setOpen(false); };
  if (mq.addEventListener) mq.addEventListener('change', onWide); else if (mq.addListener) mq.addListener(onWide);
})();
