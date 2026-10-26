#!/usr/bin/env python3
"""Write the one shared header and footer into every public page.

    python3 scripts/build-chrome.py          # rewrite all pages
    python3 scripts/build-chrome.py --check  # exit 1 if any page is out of date (CI)

Each page gets, between markers it can be found by later:
  <!-- OM:HEADER --> ... <!-- /OM:HEADER -->   right after <body>
  <!-- OM:FOOTER --> ... <!-- /OM:FOOTER -->   where the page's old footer was
plus /site.css in <head> and /site.js before </body>. Old menus (the
ORCHAMIND_UNIFIED_NAV block, page-specific <nav>s and the scripts that drove
them) and old <footer>s are removed the first time. Running it again changes
nothing unless the templates below changed, so the header can never drift
from page to page again.

The menu, the logo and the footer live ONLY in this file.
"""
import re, sys, os, html

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
VERSION = '4'   # bump when site.css / site.js change, to bust caches

# Pages that are app screens or one-off utilities: no marketing header.
SKIP = {'demo.html', 'demo-test.html', 'portal.html', 'quote.html', 'paid.html', 'welcome.html', 'embed-preview.html', 'bench/index.html'}

LOGO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>'
CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>'

INDUSTRIES = [
    ('/for/general-contractors/', 'General contractors', 'Estimates, crews and clients in one place'),
    ('/for/electricians/', 'Electricians', 'Panel and service-upgrade quotes, dispatch'),
    ('/for/hvac/', 'HVAC', 'Installs, service calls, maintenance plans'),
    ('/for/plumbers/', 'Plumbers', 'Repairs, repipes and service work'),
    ('/for/roofers/', 'Roofers', 'Roof measurements, materials, crews'),
]
RESOURCES = [
    ('/videos/meet-orchamind/', 'Video: Meet Orchamind', '30 seconds'),
    ('/knowledge-base/', 'Knowledge base', 'Everything it does, step by step'),
    ('/faq/', 'FAQ', 'Pricing, phones, voice, data'),
    ('/compare/', 'Compare', 'vs Jobber, ServiceTitan, Buildertrend'),
    ('/how-to-estimate-a-job/', 'How to estimate a job', 'Guide'),
    ('/contractor-chaos-score/', 'Contractor Chaos Score', '2-minute quiz'),
]
MAIN = [  # (href, label, matches) ; matches = path prefixes that make it "current"
    ('/what-is-orchamind/', 'What is it', ['/what-is-orchamind/']),
    ('/how-it-works/', 'How it works', ['/how-it-works/']),
    ('/features/', 'Features', ['/features/']),
    ('DROP:industries', 'Industries', ['/industries/', '/for/', '/software-for-']),
    ('/pricing/', 'Pricing', ['/pricing/']),
    ('DROP:resources', 'Resources', ['/resources/', '/videos/', '/knowledge-base/', '/faq/', '/compare/', '/how-to-', '/contractor-chaos-score/', '/best-', '/ai-', '/field-service-software/', '/proposal-generator/']),
    ('/about/', 'About', ['/about/']),
    ('/contact/', 'Contact', ['/contact/', '/book/']),
]


def url_path(rel):
    rel = rel.replace(os.sep, '/')
    if rel == 'index.html':
        return '/'
    if rel.endswith('/index.html'):
        return '/' + rel[:-len('index.html')]
    return '/' + rel[:-len('.html')]


def cur(path, href):
    return ' aria-current="page"' if path == href else ''


def header(path):
    def is_cur(matches):
        return any(path.startswith(m) for m in matches)
    items = []
    for href, label, matches in MAIN:
        if href.startswith('DROP:'):
            key = href.split(':')[1]
            rows = INDUSTRIES if key == 'industries' else RESOURCES
            hub = ('/industries/', 'All industries &rarr;') if key == 'industries' else ('/resources/', 'All resources &rarr;')
            links = ''.join('<a href="%s"%s>%s<small>%s</small></a>' % (h, cur(path, h), html.escape(t), html.escape(d)) for h, t, d in rows)
            links += '<a class="omh-menu-all" href="%s"%s>%s</a>' % (hub[0], cur(path, hub[0]), hub[1])
            items.append('<div class="omh-dd%s"><button type="button" aria-expanded="false" aria-haspopup="true">%s %s</button><div class="omh-menu">%s</div></div>'
                         % (' current' if is_cur(matches) else '', label, CARET, links))
        else:
            items.append('<a class="omh-link" href="%s"%s>%s</a>' % (href, ' aria-current="page"' if is_cur(matches) else '', label))
    cta = '<a class="omh-btn omh-btn-ghost" href="/demo.html?demo=1">Try Demo</a><a class="omh-btn omh-btn-solid" href="/app?signup=1">Start free</a>'
    return ('<!-- OM:HEADER -->\n'
            '<a class="om-skip" href="#om-main" style="position:absolute;left:-9999px;top:0;z-index:2000;background:#F9A825;color:#0A1628;padding:10px 14px;font:600 14px Inter,sans-serif" onfocus="this.style.left=\'8px\'" onblur="this.style.left=\'-9999px\'">Skip to content</a>\n'
            '<div class="omh" id="omh" role="banner"><div class="omh-in">'
            '<a class="omh-logo" href="/" aria-label="Orchamind home"><span class="omh-mark">%s</span>Orchamind</a>'
            '<nav class="omh-nav" aria-label="Main">%s<div class="omh-sheet-cta">%s</div></nav>'
            '<div class="omh-cta">%s</div>'
            '<button class="omh-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="omh"><span></span></button>'
            '</div></div>\n<span id="om-main"></span>\n'
            '<!-- /OM:HEADER -->') % (LOGO_SVG, ''.join(items), cta, cta)


def footer():
    col = lambda title, rows: '<div><h4>%s</h4><ul>%s</ul></div>' % (title, ''.join('<li><a href="%s">%s</a></li>' % (h, t) for h, t in rows))
    return ('<!-- OM:FOOTER -->\n<div class="omf" role="contentinfo"><div class="omf-in"><div class="omf-grid">'
            '<div class="omf-brand"><a class="omh-logo" href="/"><span class="omh-mark">%s</span>Orchamind</a>'
            '<p>The AI office manager for contractors. Run your jobs, crew and estimates by talking to your phone.</p>'
            '<div class="omf-contact"><a href="tel:+13236577752">(323) 657-7752</a><a href="mailto:siamakk2@gmail.com">siamakk2@gmail.com</a></div></div>'
            % LOGO_SVG
            + col('Product', [('/what-is-orchamind/', 'What is Orchamind'), ('/how-it-works/', 'How it works'), ('/features/', 'Features'), ('/pricing/', 'Pricing'), ('/demo.html?demo=1', 'Live demo'), ('/app?signup=1', 'Start free')])
            + col('Industries', [(h, t) for h, t, _ in INDUSTRIES] + [('/industries/', 'All industries')])
            + col('Resources', [('/videos/meet-orchamind/', 'Video'), ('/knowledge-base/', 'Knowledge base'), ('/faq/', 'FAQ'), ('/compare/', 'Compare'), ('/how-to-estimate-a-job/', 'Estimating guide'), ('/resources/', 'All resources')])
            + col('Company', [('/about/', 'About'), ('/contact/', 'Contact'), ('/book/', 'Book a walkthrough'), ('/audit', 'Free site audit'), ('/privacy', 'Privacy'), ('/terms', 'Terms')])
            + '</div>'
            '<div class="omf-family"><b>More from Siamak Kalhor Consulting</b>'
            '<a href="https://resbizai.com" target="_blank" rel="noopener">ResBizAI <span>&mdash; AI software for restaurants</span></a>'
            '<a href="https://aislebird.com" target="_blank" rel="noopener">AisleBird <span>&mdash; AI grocery-list app</span></a>'
            '<a href="https://siamakconsulting.com" target="_blank" rel="noopener">Siamak Kalhor Consulting <span>&mdash; AI marketing &amp; LLMO</span></a></div>'
            '<div class="omf-bottom"><span>&copy; 2026 Orchamind &middot; Built in Napa Valley by Siamak Kalhor</span>'
            '<span><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/eula">EULA</a></span></div>'
            '</div></div>\n<!-- /OM:FOOTER -->')


OLD_NAV_BLOCK = re.compile(r'<!-- ORCHAMIND_UNIFIED_NAV -->.*?<!-- /ORCHAMIND_UNIFIED_NAV -->\s*', re.S)
OLD_NAV = re.compile(r'<nav\b[^>]*>.*?</nav>\s*', re.S)
OLD_FOOTER = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)
OLD_SKC = re.compile(r'<div class="skc-portfolio".*?</div></div>\s*', re.S)
OLD_NAV_SCRIPT = re.compile(r'<script>(?:(?!</script>).)*?(ocnavRoot|ocnavToggle)(?:(?!</script>).)*?</script>\s*', re.S)
HEADER_RE = re.compile(r'<!-- OM:HEADER -->.*?<!-- /OM:HEADER -->', re.S)
FOOTER_RE = re.compile(r'<!-- OM:FOOTER -->.*?<!-- /OM:FOOTER -->', re.S)


UNCLOSED_OLD_NAV = re.compile(r'<!-- ORCHAMIND_UNIFIED_NAV -->(?:(?!<!-- /ORCHAMIND_UNIFIED_NAV -->).)*?</nav>\s*(<script>(?:(?!</script>).)*?ocnav(?:(?!</script>).)*?</script>\s*)?', re.S)


def process(rel, s):
    path = url_path(rel)
    h, f = header(path), footer()
    # Old menu blocks that lost their closing marker: drop through the end of their <nav> (and its script).
    if '<!-- /ORCHAMIND_UNIFIED_NAV -->' not in s:
        s = UNCLOSED_OLD_NAV.sub('', s)
    if HEADER_RE.search(s):
        s = HEADER_RE.sub(lambda m: h, s, count=1)
    else:
        s = OLD_NAV_BLOCK.sub('', s, count=1)
        s = OLD_NAV_SCRIPT.sub('', s)
        body = re.search(r'<body\b[^>]*>', s)
        after = s[body.end():]
        # A page-specific <nav> sitting at the top of the body is the old menu.
        m = OLD_NAV.match(after.lstrip())
        if m and after.lstrip().startswith('<nav'):
            lead = len(after) - len(after.lstrip())
            after = after[:lead] + after[lead + m.end():]
        s = s[:body.end()] + '\n' + h + '\n' + after
    if FOOTER_RE.search(s):
        s = FOOTER_RE.sub(lambda m: f, s, count=1)
    else:
        s = OLD_SKC.sub('', s)
        if OLD_FOOTER.search(s):
            s = OLD_FOOTER.sub(lambda m: f, s, count=1)
        else:
            i = s.rfind('</body>')
            # keep page scripts after the content: put the footer before the trailing scripts
            tail = s[:i]
            j = len(tail)
            while True:
                k = tail.rstrip().rfind('</script>')
                if k == -1 or k + len('</script>') != len(tail.rstrip()):
                    break
                start = tail.rfind('<script', 0, k)
                if start == -1:
                    break
                tail = tail[:start]
            j = len(tail)
            s = s[:j] + f + '\n' + s[j:]
    css = '<link rel="stylesheet" href="/site.css?v=%s">' % VERSION
    s = re.sub(r'<link rel="stylesheet" href="/site\.css(\?v=[^"]*)?">\n?', '', s)
    s = s.replace('</head>', css + '\n</head>', 1)
    js = '<script src="/site.js?v=%s" defer></script>' % VERSION
    s = re.sub(r'<script src="/site\.js(\?v=[^"]*)?" defer></script>\n?', '', s)
    i = s.rfind('</body>')
    s = s[:i] + js + '\n' + s[i:]
    return s


def pages():
    out = []
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if not d.startswith('.') and d not in ('node_modules', 'api', 'lib', 'scripts', 'media', 'knowledge-base-assets')]
        for f in fn:
            if f.endswith('.html'):
                rel = os.path.relpath(os.path.join(dp, f), ROOT).replace(os.sep, '/')
                if rel not in SKIP:
                    out.append(rel)
    return sorted(out)


def main():
    check = '--check' in sys.argv
    stale = []
    for rel in pages():
        p = os.path.join(ROOT, rel)
        s = open(p, encoding='utf-8').read()
        if '<body' not in s:
            continue
        new = process(rel, s)
        if new != s:
            stale.append(rel)
            if not check:
                open(p, 'w', encoding='utf-8').write(new)
    if check:
        if stale:
            print('Header/footer out of date on: ' + ', '.join(stale) + '\nRun: python3 scripts/build-chrome.py')
            sys.exit(1)
        print('Header/footer identical on all %d pages.' % len(pages()))
    else:
        print('Updated %d page(s): %s' % (len(stale), ', '.join(stale)))


if __name__ == '__main__':
    main()
