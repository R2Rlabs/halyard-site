# halyard-site

The landing page for Halyard, served at https://halyard.r2rlabs.com. One file, `index.html`, with no
build step and no dependencies beyond Google Fonts.

## Deploying on GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Build from branch `main`, folder `/` (root).
3. Set the custom domain to `halyard.r2rlabs.com`. The `CNAME` file in this repo does the same thing.
4. In Hostinger DNS, add a CNAME record: host `halyard`, pointing to `r2rlabs.github.io`.
5. Wait for the certificate, then tick "Enforce HTTPS".

Netlify, Vercel and Cloudflare Pages work the same way: point them at the repo and add the CNAME.

## The waitlist form

`ENDPOINT` in the script at the bottom of `index.html` is empty. While it is, the form opens the
visitor's email app addressed to hello@r2rlabs.com, so no address is ever silently lost.

To collect addresses properly, set `ENDPOINT` to a form service that accepts a JSON POST: Formspree,
Buttondown, Tally or your own handler. Whatever you choose stores personal data, so check where it
keeps it and say so on the page if the answer matters.

Mail sent from any new service must be added to SPF and DKIM on r2rlabs.com first: DMARC is set to
`p=reject`, so unauthenticated mail claiming to be from the domain is rejected outright.

## What the page claims, and what has to stay true

- 5× maximum leverage, the experience check before a first deposit, and the 14-day beginner limits.
- No US users.
- No promised returns, for traders or backers.
- The proof-of-concept figures (about 5 ms, 78 tests, 0 bad updates) come from `trac-oracle-poc`.
  Re-run the tests before changing them.
- "In development, not live" must stay until it is actually live.
