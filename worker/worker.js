// A counter, and nothing more.
//
// The site is static, so anything we want to know about usage has to be sent somewhere. This is that
// somewhere, and it is ours: no analytics company, no third party, no data leaving our own account.
//
// What it stores is a set of integers per hour — how many practice positions were opened, closed and
// liquidated, and how many people loaded the trading screen. There is no cookie, no identifier, no
// session, no IP address and no user agent kept, so the numbers cannot be traced back to a person
// even by us. That is deliberate: a count we cannot misuse is a count we never have to defend.
//
// Deploy: see README.md in this folder.

const ALLOWED_ORIGIN = 'https://halyard.r2rlabs.com';
const EVENTS = ['visit', 'open', 'close', 'liquidated', 'expired'];

// Keys look like "open:2026-09-25T14". One per event, per hour, counted up.
const hourKey = (event, date = new Date()) => `${event}:${date.toISOString().slice(0, 13)}`;

const cors = (origin) => ({
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
});

async function record(env, event) {
    const key = hourKey(event);
    const current = Number(await env.STATS.get(key)) || 0;
    // 90 days is long enough to see a trend and short enough that nothing lingers.
    await env.STATS.put(key, String(current + 1), { expirationTtl: 60 * 60 * 24 * 90 });
}

async function readRange(env, event, hours) {
    const now = new Date();
    const keys = [];
    for (let i = 0; i < hours; i++) {
        keys.push(hourKey(event, new Date(now.getTime() - i * 3600_000)));
    }
    const values = await Promise.all(keys.map((k) => env.STATS.get(k)));
    return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
}

async function summary(env) {
    const windows = { last12h: 12, last24h: 24, last7d: 24 * 7 };
    const out = {};
    for (const [label, hours] of Object.entries(windows)) {
        out[label] = {};
        for (const event of EVENTS) out[label][event] = await readRange(env, event, hours);
    }
    out.generatedAt = new Date().toISOString();
    return out;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin') ?? '';

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors(origin) });
        }

        // Counting. One event per request, no body read, nothing else stored.
        if (url.pathname === '/e' && request.method === 'POST') {
            const event = url.searchParams.get('k');
            if (!EVENTS.includes(event)) {
                return new Response('unknown event', { status: 400, headers: cors(origin) });
            }
            if (origin && origin !== ALLOWED_ORIGIN) {
                return new Response('forbidden origin', { status: 403, headers: cors(origin) });
            }
            await record(env, event);
            return new Response(null, { status: 204, headers: cors(origin) });
        }

        // Reading. Private until we decide otherwise: the token is a Worker secret, never in the repo.
        if (url.pathname === '/s') {
            const token = url.searchParams.get('t') ?? '';
            if (!env.STATS_TOKEN || token !== env.STATS_TOKEN) {
                return new Response('no', { status: 401 });
            }
            const data = await summary(env);
            if (url.searchParams.get('format') === 'json') {
                return new Response(JSON.stringify(data, null, 2), {
                    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                });
            }
            return new Response(page(data), {
                headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
            });
        }

        return new Response('halyard counter', { status: 404 });
    },
};

function page(d) {
    const row = (label, key) => `<tr><td>${label}</td><td>${d.last12h[key]}</td><td>${d.last24h[key]}</td><td>${d.last7d[key]}</td></tr>`;
    return `<!doctype html><meta charset="utf-8"><title>Halyard usage</title>
<meta name="robots" content="noindex,nofollow">
<style>
body{background:#0B0E13;color:#E7EAEE;font:15px/1.6 system-ui,sans-serif;margin:0;padding:40px 20px}
.wrap{max-width:620px;margin:0 auto}
h1{font-size:22px;font-weight:600;margin:0 0 4px}
p{color:#98A2B0;font-size:13px;margin:0 0 24px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #242B35}
th{color:#98A2B0;font-size:12px;font-weight:500}
td:not(:first-child){font-family:ui-monospace,monospace;font-size:17px}
td:first-child{color:#A9B2BF}
</style>
<div class="wrap">
<h1>Halyard usage</h1>
<p>Practice only. No cookies, no identifiers, nobody's numbers but the totals. Generated ${d.generatedAt}.</p>
<table>
<tr><th></th><th>12 hours</th><th>24 hours</th><th>7 days</th></tr>
${row('Screen loaded', 'visit')}
${row('Positions opened', 'open')}
${row('Positions closed', 'close')}
${row('Liquidated', 'liquidated')}
${row('Orders expired unmatched', 'expired')}
</table>
</div>`;
}
