// Prints what the counter and the Arena actually hold, without needing the token.
// Usage: node usage.js
const { execFileSync } = require('child_process');

const NS = '426fe74d9e9f482ab4b338029f76e7db';
const wrangler = (args) => execFileSync('npx.cmd', ['wrangler', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true, maxBuffer: 32 * 1024 * 1024 });

const listKeys = () => {
    const out = wrangler(['kv', 'key', 'list', `--namespace-id=${NS}`, '--remote']);
    const json = out.slice(out.indexOf('['));
    return JSON.parse(json).map((k) => k.name);
};

const get = (key) => {
    try {
        return wrangler(['kv', 'key', 'get', `--namespace-id=${NS}`, '--remote', JSON.stringify(key)])
            .trim().split('\n').pop();
    } catch { return null; }
};

const keys = listKeys();

// --- usage events -------------------------------------------------------------------------------
const events = ['visit', 'open', 'close', 'liquidated', 'expired'];
const totals = Object.fromEntries(events.map((e) => [e, 0]));
const byDay = {};

for (const key of keys) {
    const [kind, stamp] = key.split(':');
    if (!events.includes(kind) || !stamp) continue;
    const n = Number(get(key)) || 0;
    totals[kind] += n;
    const day = stamp.slice(0, 10);
    byDay[day] ??= Object.fromEntries(events.map((e) => [e, 0]));
    byDay[day][kind] += n;
}

console.log('=== totals since the counter went live ===');
for (const e of events) console.log('  ' + e.padEnd(11), totals[e]);

console.log('\n=== by day ===');
for (const day of Object.keys(byDay).sort()) {
    const d = byDay[day];
    console.log(`  ${day}  loads ${String(d.visit).padStart(3)}   opened ${String(d.open).padStart(3)}   closed ${String(d.close).padStart(3)}   liq ${String(d.liquidated).padStart(2)}   expired ${String(d.expired).padStart(2)}`);
}

// --- the arena ----------------------------------------------------------------------------------
console.log('\n=== arena players ===');
const players = keys.filter((k) => k.includes(':player:'));
if (!players.length) console.log('  (none)');
for (const key of players) {
    const raw = get(key);
    if (!raw) continue;
    const p = JSON.parse(raw);
    console.log(`  ${String(p.name).padEnd(12)} ${p.house ? 'house bot' : 'HUMAN    '}  balance ${String(p.balance.toFixed(2)).padStart(9)}  trades ${String(p.trades).padStart(3)}`
        + (p.fees !== undefined ? `  fees ${String((-p.fees).toFixed(2)).padStart(8)}  gross ${String(p.gross.toFixed(2)).padStart(8)}` : ''));
}

const humans = players.filter((k) => !/momentum|fade|coin flip/.test(k));
console.log(`\n  ${humans.length} human player${humans.length === 1 ? '' : 's'} joined`);
