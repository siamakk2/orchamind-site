---
name: ef-store-pulse
description: >
  Produces Exquisite Fabric's morning store pulse from Shopify: yesterday's sales and orders against
  the same day last week, unfulfilled or stuck orders, refunds and returns, top and slowest fabrics,
  traffic and conversion, and anything unusual. Read-only. Use when the owner says "store pulse",
  "how did we do yesterday", "morning report", "sales yesterday", or "anything wrong with orders".
allowed-tools: Read
---

# Exquisite Fabric — Store Pulse

Five minutes of reading that replaces opening Shopify admin and clicking through six screens.

## Step 1 — Pull the numbers

Run these ShopifyQL queries with `run-analytics-query`:

- `FROM sales SHOW orders, gross_sales, discounts, sales_reversals, net_sales, average_order_value TIMESERIES day SINCE -8d UNTIL today`
- `FROM sales SHOW net_sales, orders GROUP BY product_title ORDER BY net_sales DESC LIMIT 10 SINCE -1d UNTIL today`
- `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, conversion_rate TIMESERIES day SINCE -8d UNTIL today`
- `FROM sales SHOW orders, net_sales GROUP BY order_referrer_source SINCE -1d UNTIL today`

Then `list-orders` with `fulfillment_status:unfulfilled` for open orders.

## Step 2 — Compare like with like

Compare yesterday to the same weekday last week, not to the day before — fabric orders follow a
weekly rhythm. Show the change in dollars and percent.

## Step 3 — Find what needs attention

- Unfulfilled orders older than 2 business days — list each with order number and customer
- Any refund or sales reversal — order, amount, reason if recorded
- Conversion down more than 30% vs. same weekday with normal traffic — possible checkout problem
- A product selling 3× its usual rate — may need a restock check today
- Zero orders on a day with normal traffic — treat as a possible site problem, flag first

## Step 4 — Write it short

```
Store pulse — <yesterday's date>
Sales  $<net>  (<+/-%> vs last <weekday>)   Orders <n>   AOV $<x>
Traffic <sessions>   Conversion <x>%
Top fabrics: <1>, <2>, <3>
Watch: <items from Step 3, or "nothing unusual">
```

## What not to do

- **Never change an order** — this skill only reads.
- **Never fill a gap with an estimate.** If a query fails, the line says "not available".
