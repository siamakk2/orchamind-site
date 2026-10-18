---
name: ef-product-listings
description: >
  Audits and improves Exquisite Fabric's Shopify product listings: finds fabrics missing fiber
  content, width, weight, care, pattern repeat, photos, or alt text; rewrites weak titles and
  descriptions in an answer-first style that search engines and AI assistants can quote; and stages
  the changes for the owner to approve before anything goes live. Use when the owner says "fix the
  listings", "product descriptions", "new fabrics to list", "improve product pages", or "listing audit".
allowed-tools: Read
---

# Exquisite Fabric — Product Listings

A fabric buyer can't touch the cloth online. The listing has to answer what their hand would:
what it's made of, how wide, how heavy, how it drapes, how to care for it.

## Step 1 — Pull the catalog

`search_products` with `status:active`, 50 at a time, sorted by `INVENTORY_TOTAL` descending, so the
fabrics with the most stock — the most money sitting on the shelf — get fixed first.

## Step 2 — Score each listing

Check for, and score 0/1 each:
fiber content · width (inches) · weight (gsm or oz) · care · use cases (dress, upholstery, drapery,
bridal…) · sold-by unit (yard / meter / bolt) · at least 3 photos · alt text on every image ·
title naming fiber + weave + color · description over 80 words.

Report the bottom 10 by score.

## Step 3 — Draft the fixes

For each of the bottom 10, draft:

- **Title:** `<Color> <Fiber> <Weave> Fabric — <Width>" Wide` (e.g. Ivory Silk Charmeuse Fabric — 45" Wide)
- **First sentence answers "what is it and what is it for"** — this is the line AI assistants quote.
- **Spec block:** fiber, width, weight, care, sold by.
- **Alt text** for each image.

**Never invent a spec.** If width or fiber content is not in Shopify, the draft says
`<MISSING — owner to confirm>` and the item goes on the owner's list.

## Step 4 — Approval gate, then update

```
<n> listings ready. Changes: <n> titles, <n> descriptions, <n> alt texts.
<n> listings need specs from you first (listed below).
Publish these <n> updates to exquisitefabric.com?
```

On yes, apply with `update-product`, one product at a time, and report any that failed.

## What not to do

- **Never change price, inventory, or published status** — out of scope for this job.
- **Never copy a supplier's description verbatim** — duplicate text weakens the page.
