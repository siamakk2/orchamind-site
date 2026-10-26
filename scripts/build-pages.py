#!/usr/bin/env python3
"""Builds the stand-alone learning pages behind each main-menu item:
/what-is-orchamind/, /how-it-works/, /pricing/, /about/, /industries/, /resources/.

Each page gets the same head (consent, analytics, fonts, canonical, OG,
WebPage + BreadcrumbList schema), the shared .omp components from /site.css,
and the shared header/footer from scripts/build-chrome.py (run it after this).

Usage: python3 scripts/build-pages.py && python3 scripts/build-chrome.py
"""
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://orchamind.com'
TODAY = '2026-10-25'


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


# Consent Mode + deferred analytics: reuse the exact block the FAQ page ships.
_faq = read('faq/index.html')
HEAD_SCRIPTS = _faq[_faq.index('<!-- Consent Mode v2'):_faq.index('<meta name="viewport"')].strip()
# Contact-sales bubble + consent banner script, also shared with the FAQ page.
TAIL = _faq[_faq.index('<script src="/share.js"'):_faq.index('<script src="/site.js')].strip()

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap">')

START = '/app?signup=1'
DEMO = '/demo.html?demo=1'


def esc(s):
    return html.escape(s, quote=True)


def page(slug, title, desc, crumb, body, extra_schema=None, og_image='/og-image.jpg'):
    url = SITE + '/' + slug + '/'
    graph = [
        {'@type': 'WebPage', '@id': url + '#page', 'url': url, 'name': title, 'description': desc,
         'inLanguage': 'en-US', 'dateModified': TODAY,
         'isPartOf': {'@type': 'WebSite', '@id': SITE + '/#website', 'name': 'Orchamind', 'url': SITE + '/'},
         'publisher': {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Orchamind', 'url': SITE + '/',
                       'logo': SITE + '/apple-touch-icon.png'}},
        {'@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': crumb, 'item': url}]},
    ] + (extra_schema or [])
    ld = json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False).replace('</', '<\\/')
    img = SITE + og_image
    out = f'''<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
{HEAD_SCRIPTS}
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="{url}">
<link rel="icon" href="/favicon.ico?v=4" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=4"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4"><meta name="theme-color" content="#0A1628">
<meta property="og:type" content="website"><meta property="og:site_name" content="Orchamind"><meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{img}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{esc(title)}"><meta name="twitter:description" content="{esc(desc)}"><meta name="twitter:image" content="{img}">
<script type="application/ld+json">{ld}</script>
{FONTS}
<style>body{{margin:0;background:#fff;}}</style>
</head><body>
<main class="omp" id="main">
{body}
</main>
{TAIL}
</body></html>
'''
    path = os.path.join(ROOT, slug, 'index.html')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    return path


def hero(crumb, eyebrow, h1, lead, photo=None, btns=None):
    cls = 'omp-hero photo' if photo else 'omp-hero'
    style = f' style="--omp-bg:url(\'{photo}\')"' if photo else ''
    btns = btns or [(START, 'Start free &mdash; first month on us', 'amber'), (DEMO, 'Try the live demo', 'line')]
    b = ''.join(f'<a class="omp-btn omp-btn-{k}" href="{h}">{t}</a>' for h, t, k in btns)
    return (f'<section class="{cls}"{style}><div class="omp-wrap">'
            f'<nav class="omp-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; {crumb}</nav>'
            f'<span class="omp-eyebrow">{eyebrow}</span><h1>{h1}</h1><p class="omp-lead">{lead}</p>'
            f'<div class="omp-btns">{b}</div></div></section>')


def sec(inner, kind=''):
    return f'<section class="omp-sec {kind}"><div class="omp-wrap">{inner}</div></section>'


def head2(label, h2, sub=''):
    return (f'<span class="omp-label">{label}</span><h2>{h2}</h2>' + (f'<p class="omp-sub">{sub}</p>' if sub else ''))


def cards(items, cols=3, link_text=None):
    out = []
    for it in items:
        top = it.get('top', '')
        more = f'<span class="omp-more">{it.get("more", link_text or "Learn more")} &rarr;</span>' if it.get('href') else ''
        inner = f'{top}<h3>{it["h"]}</h3><p>{it["p"]}</p>{more}'
        if it.get('href'):
            out.append(f'<a class="omp-card" href="{it["href"]}">{inner}</a>')
        else:
            out.append(f'<div class="omp-card">{inner}</div>')
    return f'<div class="omp-grid c{cols}">' + ''.join(out) + '</div>'


def checks(items):
    return '<ul class="omp-checks">' + ''.join(f'<li>{i}</li>' for i in items) + '</ul>'


def cta(h2='See it on your own jobs.', p='First month free, then $500/month per company. No card to start, cancel anytime.'):
    return (f'<section class="omp-cta"><div class="omp-wrap"><h2>{h2}</h2><p>{p}</p><div class="omp-btns">'
            f'<a class="omp-btn omp-btn-amber" href="{START}">Start free</a>'
            f'<a class="omp-btn omp-btn-line" href="/contact/">Book a walkthrough</a></div></div></section>')


def faq_block(qas):
    html_ = '<div class="omp-faq" style="margin-top:30px;max-width:820px">' + ''.join(
        f'<details><summary>{q}</summary><p>{a}</p></details>' for q, a in qas) + '</div>'
    schema = {'@type': 'FAQPage', 'mainEntity': [
        {'@type': 'Question', 'name': re.sub('<[^>]+>', '', q),
         'acceptedAnswer': {'@type': 'Answer', 'text': re.sub('<[^>]+>', '', a)}} for q, a in qas]}
    return html_, schema


def img(src, alt, w, h, lazy=True):
    return f'<img src="{src}" alt="{esc(alt)}" width="{w}" height="{h}"' + (' loading="lazy" decoding="async"' if lazy else '') + '>'


# ---------------------------------------------------------------- What is it
def what_is():
    body = hero('What is Orchamind', 'In plain English',
                'The office manager that <em>never forgets</em> a job.',
                'Orchamind is AI software for contractors and field-service businesses. It keeps track of your jobs, crew and hours, '
                'writes estimates from a photo of the plans, and tells you each morning what needs your attention. You run it by talking to your phone.',
                photo='/media/home/hero-1920.webp')
    body += sec('<div class="omp-split"><div>' + head2('The short version', 'Like having your sharpest office manager in the truck with you.',
        'One who remembers every job, every worker and every hour, and works around the clock. You don&rsquo;t type into spreadsheets or learn '
        'complicated software. You say &ldquo;log 8 hours for Mike at the Johnson job&rdquo; and it updates everything, keeps the whole team in sync, '
        'and tells you each morning what needs you first.') +
        checks(['No spreadsheets, no training, no tech skills', 'If you can send a text, you can run your whole operation with it',
                'Works on phone, tablet and desktop, synced across your team']) +
        '<div class="omp-btns"><a class="omp-btn omp-btn-blue" href="/videos/meet-orchamind/">Watch the 30-second video</a>'
        '<a class="omp-btn omp-btn-line dark" href="/how-it-works/">How it works</a></div></div>'
        '<div class="omp-vid"><video controls playsinline preload="none" poster="/media/video/meet-orchamind-540.jpg" width="540" height="960" '
        'aria-label="Meet Orchamind in 30 seconds"><source src="/media/video/meet-orchamind.mp4" type="video/mp4"></video></div></div>')
    body += sec(head2('The problem it solves', 'Running a field business lives in your head and a hundred text messages.',
        'Where&rsquo;s each job? Who&rsquo;s on site? Did anyone order the materials? Who&rsquo;s over budget? The answers are scattered across calls, '
        'texts, whiteboards and memory, and the moment you step away it falls apart.') +
        cards([{'h': 'It&rsquo;s all in your head', 'p': 'Every job status, crew assignment and deadline. If you&rsquo;re not there, nobody else has the full picture.'},
               {'h': 'Problems surface too late', 'p': 'A job slips over budget or misses an inspection, and you find out after it has already cost you money.'},
               {'h': 'Paperwork eats your evenings', 'p': 'Hours, updates, client emails and estimates pile up long after the crews go home.'}]), 'alt')
    body += sec(head2('What it does', 'One app for the whole job, with an AI that does the work.',
        'Orchamind replaces the stack of tools contractors juggle and puts an assistant on top of all of it.') +
        cards([{'top': '<span class="omp-ico">$</span>', 'h': 'Writes your estimates', 'p': 'Describe the job or snap the plans. AI drafts an itemized estimate with labor, materials and pricing.', 'href': '/ai-estimating/'},
               {'top': '<span class="omp-ico">&#9634;</span>', 'h': 'Turns plans into 3D', 'p': 'Reads the drawing, prices the takeoff and shows the house in 3D and as a finished picture.', 'href': '/features/plan-takeoff/'},
               {'top': '<span class="omp-ico">&#9742;</span>', 'h': 'Runs by voice', 'p': 'Log hours, move crew and update jobs hands-free from the truck or the site.', 'href': '/how-it-works/'},
               {'top': '<span class="omp-ico">&#9728;</span>', 'h': 'Morning briefing', 'p': 'A plain-English rundown each day of what needs your attention first.', 'href': '/how-it-works/'},
               {'top': '<span class="omp-ico">&#9888;</span>', 'h': 'Risk Radar', 'p': 'Flags jobs trending over budget, slipping schedules and upcoming inspections early.', 'href': '/how-it-works/'},
               {'top': '<span class="omp-ico">&#9998;</span>', 'h': 'Client portal & billing', 'p': 'A private project page for each client, AI progress updates, invoices and job costing.', 'href': '/features/'}]))
    body += sec('<div class="omp-split"><div>' + head2('Who it&rsquo;s for', 'Built for construction. Made for every field business.',
        'General contractors, electricians, plumbers, HVAC, roofers, painters, landscapers and any business that runs jobs with a team in the field.') +
        '<div class="omp-btns"><a class="omp-btn omp-btn-blue" href="/industries/">See industries</a>'
        '<a class="omp-btn omp-btn-line dark" href="/pricing/">See pricing</a></div></div>' +
        img('/media/home/crew-900.webp', 'Construction crew on a job site', 900, 1125) + '</div>', 'alt')
    body += cta()
    return page('what-is-orchamind', 'What Is Orchamind? AI Software for Contractors | Orchamind',
                'Orchamind is AI software for contractors: it tracks jobs, crew and hours, writes estimates from plans, and gives you a morning briefing. Run it by talking to your phone.',
                'What is Orchamind', body)


# ---------------------------------------------------------------- How it works
def how_it_works():
    body = hero('How it works', 'How it works', 'Talk to it. <em>It does the rest.</em>',
                'No training, no manuals, no clunky software. Orchamind works the way you already think and talk about your jobs, '
                'from the first set of plans to the final invoice.', photo='/media/home/foreman-900.webp')
    steps = [('Add your jobs and crew', 'Type them in or just say them out loud. Your whole operation lives in one place, synced across your team.'),
             ('Run your day by voice', '&ldquo;Log 8 hours for Mike at the Johnson job.&rdquo; &ldquo;Move Carlos to the Napa site.&rdquo; It understands and does it.'),
             ('Get your morning briefing', 'Each day the AI reads your whole operation and tells you what needs attention first, before you&rsquo;ve had coffee.'),
             ('Catch problems early', 'Risk alerts flag tight budgets, slipping jobs and upcoming inspections while there&rsquo;s still time to act.')]
    body += sec(head2('Four steps', 'From day one to running every job by voice.') +
                cards([{'top': f'<span class="omp-num">{i}</span>', 'h': h, 'p': p} for i, (h, p) in enumerate(steps, 1)], 4))
    body += sec(head2('From plans to 3D', 'Drop in the plans. See the house before you build it.',
        'Orchamind reads the drawing, prices the takeoff, and draws the job in 3D and as a finished picture, so your client sees what they&rsquo;re paying for.') +
        '<div class="omp-grid c3">' + ''.join(
            f'<div class="omp-card" style="padding:0;overflow:hidden">{img(s, a, 1200, 900)}<div style="padding:20px 22px"><span class="omp-num">{n}</span><h3>{h}</h3><p>{p}</p></div></div>'
            for n, s, a, h, p in [
                (1, '/media/home/sample-plan-1200.webp', 'Sample floor plan sheet', 'Your plans', 'A PDF or a phone photo of the sheets.'),
                (2, '/media/home/plan3d-1200.webp', '3D floor plan generated from the drawing', '3D floor plan', 'Every room from the drawing, furnished.'),
                (3, '/media/home/exterior-1200.webp', 'Photoreal picture of the finished home', 'The finished home', 'A photoreal picture to help win the job.')]) +
        '</div><p class="omp-sub" style="margin-top:18px;font-size:14px">Real output from Orchamind&rsquo;s estimator on a sample plan. AI pictures can get details wrong, so check them before sending.</p>'
        '<div class="omp-btns"><a class="omp-btn omp-btn-blue" href="/features/plan-takeoff/">How plan takeoff works</a><a class="omp-btn omp-btn-line dark" href="/ai-estimating/">AI estimating</a></div>', 'alt')
    body += sec(head2('Inside the app', 'Everything in one place, and it talks back.') +
        cards([{'h': 'AI Morning Briefing', 'p': '&ldquo;Good morning. Three things need you today: Oak Street is at 88% of budget, Hillside has a framing inspection tomorrow, Maple Ave is a week behind.&rdquo;'},
               {'h': 'Just talk to it', 'p': '&ldquo;Log 8 hours for Mike at the Johnson job.&rdquo; &rarr; &ldquo;Done, 8 hours logged for Mike.&rdquo; Log hours, assign crew and update jobs hands-free.'},
               {'h': 'Risk Radar', 'p': 'Budget, schedule and inspection alerts that catch overruns and slipping jobs before they cost you.'},
               {'h': 'Reports & payroll', 'p': 'Hours per worker for the pay period and budget-versus-actual on every job, exportable to Excel or PDF.'}], 2), 'dark')
    body += sec('<div class="omp-split">' + img('/media/home/crew-900.webp', 'Crew member using Orchamind on site', 900, 1125) + '<div>' +
        head2('On the job site', 'Built for the crews who build.',
              'Foremen, framers, electricians and tile setters get Orchamind on the phone in their pocket.') +
        checks(['Crew sees only their own jobs, never your numbers', 'Hours, photos and notes land on the right job automatically',
                'GPS time clock, certifications and AI safety toolbox talks', 'Works with gloves on: just talk to it']) + '</div></div>')
    body += cta('Try it with your own plans.', 'Open the live demo, or start your free month and set it up for your crew.')
    return page('how-it-works', 'How Orchamind Works: Voice, Plans to 3D, Morning Briefing | Orchamind',
                'How Orchamind works: add jobs and crew, run your day by voice, get an AI morning briefing and Risk Radar alerts, and turn plans into estimates and 3D.',
                'How it works', body)


# ---------------------------------------------------------------- Pricing
def pricing():
    qas = [('How much does Orchamind cost?', 'The platform is $500 per month per company, and your first month is free. There is no per-seat charge for your crew.'),
           ('Do I need a credit card to start?', 'No. You can start your free month without a card and decide afterwards.'),
           ('Can I cancel anytime?', 'Yes. There is no long-term contract; cancel whenever you like.'),
           ('What is the $750 website?', 'A one-time, done-for-you professional website for your contracting business: copy, photos, mobile-fast, Google-ready, with a lead form and click-to-call. It is separate from the platform subscription.'),
           ('Can I get both?', 'Yes. Most contractors do both. We build the site and set up the platform together; <a href="/contact/">just ask</a>.'),
           ('How does it compare on price to ServiceTitan or Buildertrend?', 'Those tools are priced for larger companies and often charge per user. Orchamind is one flat company price built for small and mid-size contractors. See the <a href="/compare/">side-by-side comparison</a>.')]
    fq, fschema = faq_block(qas)
    body = hero('Pricing', 'Pricing', 'Simple pricing. <em>Built to pay for itself.</em>',
                'First month free, then $500 a month for your whole company. No card to start, no per-seat fees, cancel anytime.',
                btns=[(START, 'Start your free month', 'amber'), (DEMO, 'Try the live demo', 'line')])
    plat = ('<div class="omp-card omp-plan featured"><span class="omp-badge">First month free</span><span class="omp-label">Subscription &middot; The platform</span>'
            '<h3>Orchamind platform</h3><div class="omp-price">$500<small> / month per company</small></div>'
            '<p>The AI that runs your back office: estimates, bids, proposals, scheduling and follow-ups. Talk to it like your sharpest project manager who never sleeps.</p>' +
            checks(['AI estimating, plan takeoff and 3D previews', 'Good &middot; Better &middot; Best proposal generator', 'Voice and chat assistant, 24/7',
                    'Dispatch, scheduling, GPS time clock', 'Client portal, invoicing and job costing', 'Morning briefing and Risk Radar', 'Owner, manager and crew roles', 'Cancel anytime']) +
            f'<div class="omp-btns"><a class="omp-btn omp-btn-blue" href="{START}">Start your free month</a></div></div>')
    web = ('<div class="omp-card omp-plan"><span class="omp-label">One-time &middot; Done for you</span><h3>Professional website</h3>'
           '<div class="omp-price">$750<small> one-time</small></div>'
           '<p>We design, build and launch a professional website for your contracting business, with your free site audit baked in.</p>' +
           checks(['Custom website for your trade', 'Mobile-fast and Google-ready', 'Lead form and click-to-call', 'Live in days, not months']) +
           '<div class="omp-btns"><a class="omp-btn omp-btn-line dark" href="/contact/">Get your website</a></div>'
           '<p style="margin-top:14px;font-size:14px">Not sure yet? <a href="/audit" style="color:#2D7FF9">Start with a free site audit &rarr;</a></p></div>')
    body += sec(head2('Plans', 'Pick one, or do both.', 'Get a professional website once, or let the AI platform run your back office every day. Most contractors do both.') +
                f'<div class="omp-grid c2" style="align-items:start">{plat}{web}</div>')
    body += sec(head2('Pricing questions', 'Straight answers.') + fq, 'alt')
    body += cta('Your first month is on us.', 'Set it up around your jobs and crew. If it doesn&rsquo;t pay for itself, cancel.')
    offers = {'@type': 'Product', 'name': 'Orchamind', 'description': 'AI software for contractors and field-service businesses.', 'brand': {'@type': 'Brand', 'name': 'Orchamind'},
              'offers': [{'@type': 'Offer', 'name': 'Orchamind platform', 'price': '500', 'priceCurrency': 'USD', 'url': SITE + '/pricing/',
                          'priceSpecification': {'@type': 'UnitPriceSpecification', 'price': '500', 'priceCurrency': 'USD', 'unitText': 'MONTH'}},
                         {'@type': 'Offer', 'name': 'Professional contractor website', 'price': '750', 'priceCurrency': 'USD', 'url': SITE + '/pricing/'}]}
    return page('pricing', 'Orchamind Pricing: $500/month, First Month Free | Orchamind',
                'Orchamind pricing: first month free, then $500/month per company with no per-seat fees and no card to start. Optional $750 one-time professional website.',
                'Pricing', body, [fschema, offers])


# ---------------------------------------------------------------- About
def about():
    body = hero('About', 'Who&rsquo;s behind it', 'Built by someone with <em>40 years in business</em> who can build the AI.',
                'Orchamind is built by Siamak Kalhor in Napa Valley, California, and proven in the field with Howard Construction Inc.',
                photo='/media/home/hero-1920.webp', btns=[('/contact/', 'Talk to Siamak', 'amber'), (DEMO, 'Try the live demo', 'line')])
    body += sec('<div class="omp-split"><div>' + head2('The founder', 'Siamak Kalhor', '') +
        '<p class="omp-sub" style="margin-bottom:14px">Software engineer, AI developer and founder of Siamak Kalhor Consulting. For 19 years he was the voice on 670 AM KIRN explaining technology to everyday people in plain language.</p>'
        '<p class="omp-sub">With formal training in software engineering and 40 years in business, including decades as a licensed Realtor running his own firm, he knows both sides: how to build serious AI, and what a busy business owner actually needs from it. That&rsquo;s the idea behind Orchamind: powerful technology you run just by talking to it.</p>' +
        checks(['40 years in business', '19 years on 670 AM KIRN', 'Software engineer and AI developer']) + '</div>' +
        '<div class="omp-card" style="background:#0A1628;color:#fff;border:0;padding:36px"><span class="omp-label" style="color:#F9A825">Proven in the field</span>'
        '<p class="omp-quote" style="color:#fff">&ldquo;It&rsquo;s like having an office manager, a foreman, and a bookkeeper riding in the truck with me, except it never forgets anything.&rdquo;</p>'
        '<p class="omp-quote-by" style="color:rgba(255,255,255,.7)"><strong style="color:#fff">Philip Howard</strong><br>Owner, Howard Construction Inc. &middot; Santa Rosa, CA</p></div></div>')
    body += sec(head2('Howard Construction Inc.', 'Built and proven on real jobs.',
        'Orchamind was built alongside a third-generation builder with 25+ years running real jobs, and is now how those jobs are run.') +
        cards([{'h': '3rd generation', 'p': 'Builder with 25+ years running real jobs, now running them with Orchamind.'},
               {'h': 'One place', 'p': 'Every job, crew member and hour, instead of scattered across texts and memory.'},
               {'h': 'Daily', 'p': 'AI briefings that surface problems before they cost money.'}]), 'alt')
    body += sec(head2('What we believe', 'Strategy before software.') +
        cards([{'h': 'Plain language first', 'p': 'If a feature needs a manual, it isn&rsquo;t finished. You should be able to run Orchamind by talking to it.'},
               {'h': 'Your data stays yours', 'p': 'Each company gets its own private system. Crew see only their jobs; we never sell your data.', 'href': '/privacy', 'more': 'Privacy notice'},
               {'h': 'Built with contractors', 'p': 'Orchamind was built alongside Howard Construction on real job sites, not designed in a vacuum.'}]))
    body += sec(head2('Also from Siamak Kalhor Consulting', 'The family of products.') +
        cards([{'h': 'Siamak Kalhor Consulting', 'p': 'AI visibility, LLMO and fractional CMO work for growing businesses.', 'href': 'https://siamakconsulting.com/', 'more': 'Visit'},
               {'h': 'ResBizAI', 'p': 'AI tools for restaurants and hospitality.', 'href': 'https://resbizai.com/', 'more': 'Visit'},
               {'h': 'AisleBird', 'p': 'The free smart grocery list that sorts by aisle automatically.', 'href': 'https://aislebird.com/', 'more': 'Visit'}]), 'alt')
    body += cta('Talk to a real person.', 'Call or text (323) 657-7752, or email siamakk2@gmail.com. We reply the same working day.')
    person = {'@type': 'Person', '@id': SITE + '/about/#siamak', 'name': 'Siamak Kalhor', 'jobTitle': 'Founder',
              'worksFor': {'@id': SITE + '/#org'}, 'url': SITE + '/about/',
              'description': 'Software engineer, AI developer and founder of Siamak Kalhor Consulting, with 40 years in business and 19 years on 670 AM KIRN.'}
    return page('about', 'About Orchamind: Built by Siamak Kalhor in Napa Valley | Orchamind',
                'About Orchamind: AI contractor software built by Siamak Kalhor, software engineer with 40 years in business, and proven in the field with Howard Construction Inc.',
                'About', body, [person])


# ---------------------------------------------------------------- Industries
def industries():
    trades = [('/for/general-contractors/', 'General contractors & remodelers', 'Estimates from plans, crews, change orders and client updates in one place.'),
              ('/for/electricians/', 'Electricians', 'Panel and service-upgrade quotes, lighting and outlet layouts, dispatch.'),
              ('/for/hvac/', 'HVAC', 'Installs, service calls, maintenance plans and recurring revenue.'),
              ('/for/plumbers/', 'Plumbers', 'Repairs, repipes and service work, with quotes your clients understand.'),
              ('/for/roofers/', 'Roofers', 'Roof measurements, materials, crews and weather-proof scheduling.'),
              ('/field-service-software/', 'Field service businesses', 'Solar, landscaping, cleaning, pest control and every trade with a field team.')]
    body = hero('Industries', 'Who it&rsquo;s for', 'Built for construction. <em>Made for every field business.</em>',
                'If you run jobs with a team in the field, Orchamind fits. It is set up with your industry&rsquo;s language, your workflow and your way of working.',
                photo='/media/home/crew-900.webp')
    body += sec(head2('Pick your trade', 'Orchamind for your industry.') +
                cards([{'h': t, 'p': p, 'href': h} for h, t, p in trades]))
    body += sec('<div class="omp-split"><div>' + head2('Also a fit', 'Every business that runs a crew.',
        'Same platform, set up with your terms, services and price book.') +
        '<div class="omp-tags">' + ''.join(f'<span>{t}</span>' for t in ['Painting', 'Landscaping', 'Pool builders', 'Solar installers', 'Cleaning &amp; janitorial',
            'Pest control', 'Property maintenance', 'Moving companies', 'Concrete &amp; masonry', 'Flooring', 'Fencing &amp; decks']) + '</div></div>' +
        img('/media/home/foreman-900.webp', 'Foreman reviewing plans on site', 900, 1125) + '</div>', 'alt')
    body += sec(head2('Buying guides', 'Choosing software for your trade.') +
        cards([{'h': 'Best software for general contractors', 'p': 'What to look for in 2026: estimating, job tracking, crew hours and invoicing.', 'href': '/software-for-general-contractors/', 'more': 'Read the guide'},
               {'h': 'Best software for electricians', 'p': 'Estimating, layouts, job tracking and invoicing for electrical contractors.', 'href': '/software-for-electricians/', 'more': 'Read the guide'},
               {'h': 'Best contractor software 2026', 'p': 'An honest comparison of Orchamind, Jobber, Housecall Pro, ServiceTitan and Buildertrend.', 'href': '/best-contractor-software/', 'more': 'Read the comparison'}]))
    body += cta()
    items = {'@type': 'ItemList', 'name': 'Orchamind industries', 'itemListElement': [
        {'@type': 'ListItem', 'position': i, 'name': re.sub('&amp;', '&', t), 'url': SITE + h} for i, (h, t, _) in enumerate(trades, 1)]}
    return page('industries', 'Industries: AI Software for Contractors & Field Trades | Orchamind',
                'Orchamind for general contractors, electricians, HVAC, plumbers, roofers and every field-service business. Set up with your trade’s language and workflow.',
                'Industries', body, [items])


# ---------------------------------------------------------------- Resources
def resources():
    groups = [
        ('Watch &amp; learn', 'Start here', [
            ('/videos/meet-orchamind/', 'Meet Orchamind in 30 seconds', 'The AI office manager you talk to, with full transcript.'),
            ('/knowledge-base/', 'Knowledge Base', 'Step-by-step guides to every feature, each with a sketch and a plain-English answer.'),
            ('/faq/', 'Frequently asked questions', 'Pricing, voice, AI, security and getting started.')]),
        ('Guides', 'Run a more profitable business', [
            ('/how-to-estimate-a-job/', 'How to estimate a job', 'The estimating formula, labor and materials, markup, and how to stop underbidding.'),
            ('/how-to-write-construction-bid/', 'How to write a construction bid', 'The 7 parts every winning bid needs and the mistakes that lose jobs.'),
            ('/ai-estimating/', 'AI construction estimating', 'Draft an itemized estimate in minutes from a description or plans.'),
            ('/ai-construction-takeoff/', 'AI construction takeoff', 'Upload plans or photos of blueprints and let AI count rooms, square footage and fixtures.'),
            ('/ai-construction-estimate-software/', 'Can AI write a construction estimate?', 'What it gets right, and what you should still check.'),
            ('/ai-construction-drawings/', 'Can AI draw floor plans and trade layouts?', 'Concept floor plans and electrical, plumbing, HVAC and solar layouts.')]),
        ('Comparisons', 'Honest side-by-sides', [
            ('/compare/', 'Orchamind vs Jobber, Housecall Pro &amp; ServiceTitan', 'Feature by feature, including what we don&rsquo;t do yet.'),
            ('/best-contractor-software/', 'Best contractor software 2026', 'Orchamind, Jobber, Housecall Pro, ServiceTitan and Buildertrend.'),
            ('/best-ai-construction-software/', 'Best AI construction software 2026', 'Orchamind vs Procore, ServiceTitan, Buildertrend and Assignar.')]),
        ('Free tools', 'Use them today, no signup', [
            ('/contractor-chaos-score/', 'Contractor Chaos Score', 'A 60-second quiz that shows what to fix first in your operation.'),
            ('/proposal-generator/', 'Proposal generator', 'Create a professional, branded construction proposal in minutes.'),
            ('/features/materials-calculator/', 'Materials calculator', 'Fence bills of materials and countertop slab counts from plain English.'),
            ('/audit', 'Free Online Presence Report', 'How Google and AI assistants see your business, plus a new-site preview.')]),
    ]
    body = hero('Resources', 'Resources', 'Guides, tools and answers <em>for contractors.</em>',
                'Videos, step-by-step guides, honest comparisons and free tools to help you estimate, bid and run jobs better, whether or not you use Orchamind.',
                btns=[('/knowledge-base/', 'Open the Knowledge Base', 'amber'), ('/videos/meet-orchamind/', 'Watch the video', 'line')])
    n = 0
    allitems = []
    for i, (label, h2, rows) in enumerate(groups):
        cols = 3 if len(rows) % 3 == 0 else 2 if len(rows) == 4 else 3
        body += sec(head2(label, h2) + cards([{'h': t, 'p': p, 'href': h, 'more': 'Open'} for h, t, p in rows], cols), 'alt' if i % 2 else '')
        for h, t, _ in rows:
            n += 1
            allitems.append({'@type': 'ListItem', 'position': n, 'name': html.unescape(t), 'url': SITE + h})
    body += cta('Ready to try it on a real job?')
    return page('resources', 'Contractor Resources: Guides, Tools & Videos | Orchamind',
                'Free contractor resources: how to estimate a job, how to write a bid, AI takeoff guides, honest software comparisons, a proposal generator and the Orchamind Knowledge Base.',
                'Resources', body, [{'@type': 'ItemList', 'name': 'Orchamind resources', 'itemListElement': allitems}])


if __name__ == '__main__':
    for fn in (what_is, how_it_works, pricing, about, industries, resources):
        print('wrote', os.path.relpath(fn(), ROOT))
