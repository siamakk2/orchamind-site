---
name: ef-operator
description: >
  Runs Exquisite Fabric's day-to-day e-commerce operations as one agent: decides which job is due
  (store pulse, restock, customer emails, customer follow-ups, product listings, AI visibility),
  runs it against the Shopify store and the admin@exquisitefabric.com inbox, and hands the owner one
  short list of decisions to approve. Use whenever the owner says "run the store", "what needs me
  today", "Exquisite Fabric", "check the shop", "daily run", "weekly run", or names any of the six jobs
  for Exquisite Fabric.
allowed-tools: Read
---

# Exquisite Fabric Operator

The agents prepare; the owner decides. This skill is the manager: it runs the right specialist,
collects what each one found, and turns it into one list of decisions instead of six reports.

## Step 1 — Confirm the connections

Call Shopify `get-shop-info` and check the domain is exquisitefabric.com (or its myshopify domain).
If a different store answers, stop and say which store is connected — never run jobs on the wrong shop.

Check the inbox: customer mail lives at admin@exquisitefabric.com. If the connected Gmail is a
different account, the email and follow-up jobs run in **report-only mode** and say so.

Load `reference/store-profile.md` — the rules and hard limits every job must obey.

## Step 2 — Pick the jobs that are due

| Job | Cadence | Specialist |
|---|---|---|
| Store pulse | Every morning | `ef-store-pulse` |
| Inventory and restock | Daily check, PO drafts weekly (Monday) | `small-business:inventory-planner` |
| Customer emails | Each run, more than once a day | `small-business:inbox-manager`, then `customer-support:draft-response` |
| Customer relationships | Weekly (Wednesday) | `small-business:crm-autopilot`, `small-business:reactivate`, `small-business:review-reputation` |
| Product listings | Weekly batch (Thursday) | `ef-product-listings` |
| AI visibility | Monthly (1st) | `siamak-consulting:ai-authority-scan`, then `siamak-consulting:site-llmo-optimization` |
| Weekly brief | Monday | `small-business:monday-brief` |

If the owner named a job, run only that one. Otherwise run what the calendar says is due today.

## Step 3 — Run each specialist with the store profile

Pass the store profile's rules into every specialist. Where a specialist's default disagrees with
the profile (a discount ceiling, a reply tone), the profile wins.

## Step 4 — Hand over one decision list

```
Exquisite Fabric — <date>

NEEDS YOU (<n>)
  1. <decision, with the dollar amount or customer involved> — approve / edit / skip
  ...
HANDLED, FYI
  - <what ran, one line each>
NOT RUN
  - <job> — <why: connector missing, data missing>
```

Each approval item states exactly what will happen: who receives it, what it costs, what goes
live. "Ready to proceed?" is never an approval item.

## Step 5 — Execute only what was approved

Approved items run; skipped items are dropped, not retried tomorrow unless the condition still holds.
Log each executed action in the HANDLED list of the next run.

## What not to do

- **Never send, spend, publish, refund, or delete without an approved item** — this store's
  customers and suppliers see everything that goes out.
- **Never invent a number.** Missing data is reported as missing under NOT RUN.
- **Never run on an unverified store.** The connector has been switched between shops before.
- **Do not bury the owner.** Six full reports is the failure this skill exists to prevent.

## Reference files

- `reference/store-profile.md` — store facts, rules, hard limits, open questions. Read every run.
