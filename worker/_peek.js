// Reads a few Arena keys straight out of KV, for watching the bots without a token.
// Usage: node _peek.js
const { execFileSync } = require('child_process');

const NS = '426fe74d9e9f482ab4b338029f76e7db';
const get = (key) => {
    try {
        const out = execFileSync('npx.cmd',
            ['wrangler', 'kv', 'key', 'get', `--namespace-id=${NS}`, '--remote', JSON.stringify(key)],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
        return out.trim().split('\n').pop();
    } catch (e) { console.error('  ! ' + String(e.stderr || e.message).trim().slice(-160)); return null; }
};

for (const name of ['momentum', 'fade', 'coin flip']) {
    const raw = get(`arena:s1:player:${name}`);
    if (!raw) { console.log(`${name.padEnd(11)} (not found)`); continue; }
    const p = JSON.parse(raw);
    const open = p.open ? `holding ${p.open.side === 1 ? 'long' : 'short'} from ${Math.round(p.open.entry)} (tick ${p.open.ticks})` : 'flat';
    console.log(`${p.name.padEnd(11)} balance ${String(p.balance.toFixed(2)).padStart(9)}  trades ${String(p.trades).padStart(2)}  ${open}`);
}

const board = get('arena:s1:board');
console.log('\nboard:', board ?? '(empty)');
