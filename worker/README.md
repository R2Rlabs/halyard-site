# The usage counter

A Cloudflare Worker that counts practice activity and nothing else. It exists so we can answer one
question — *is anybody using this?* — without handing our visitors to an analytics company.

## What it records

Five integers per hour:

| Event | When it fires |
| --- | --- |
| `visit` | the trading screen finished loading |
| `open` | a practice position was opened |
| `close` | a position was closed by the trader, a stop-loss or a take-profit |
| `liquidated` | a position was liquidated |
| `expired` | an order found no counterparty and expired |

No cookie, no identifier, no session, no IP address, no user agent, no referrer. The Worker reads the
event name from the query string, adds one to a counter, and stops. Counts expire after 90 days.

This means we cannot tell how many *people* those numbers represent, only how many *events*. That is a
real limitation and it is the price of not tracking anyone. If we ever need unique visitors, that is a
new decision with a new privacy line to write, not a quiet upgrade.

## Deploying it

You need a free Cloudflare account. The free tier covers 100,000 requests a day, which is far more
than we will see for a long time.

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create STATS
```

That last command prints an id. Paste it into `wrangler.toml` as `id`, then:

```bash
npx wrangler secret put STATS_TOKEN
```

Type a long random string when prompted — that is the password for reading the numbers. It is stored
by Cloudflare as a secret and never appears in this repository.

```bash
npx wrangler deploy
```

Wrangler prints the Worker's URL, something like `https://halyard-counter.<account>.workers.dev`.

## Switching it on

Two things, both deliberate, so nothing is ever counted by accident:

1. Put the Worker URL into `practice/stats.js` as `ENDPOINT`. While it is empty the site sends
   nothing at all — no requests, no beacons, nothing to block.
2. Update `privacy.html` to say what is counted, because the page currently promises that we collect
   nothing. Shipping the counter without that edit would make the privacy page a lie.

## Reading the numbers

```
https://halyard-counter.<account>.workers.dev/s?t=YOUR_TOKEN
```

A plain table of the last 12 hours, 24 hours and 7 days. Add `&format=json` for the raw figures.

Anyone with the token can read it, so treat it like a password. There is nothing personal behind it,
but the numbers are ours until we choose to publish them.
