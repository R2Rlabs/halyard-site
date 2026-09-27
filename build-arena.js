// Generates arena/index.html (the tournament) from practice/index.html.
//
// The Arena is the same trading screen with two extra cards and one extra script, so it lives here as
// a transform rather than a second copy of a thousand lines of markup that would drift within a week.
//
//   node build-arena.js
//
// Run it after copying a new practice/index.html in, then commit both.

const fs = require('fs');

const BANNER = '<div class="strip"><strong>Arena</strong> '
    + '<span>A tournament on play money. Every trade is re-checked against the real price history before it counts, '
    + 'so the table cannot be faked.</span> '
    + '<a href="../">Just practising? Trade here instead &rarr;</a></div>';

const PANEL = `
    <div class="card" id="arena-panel">
      <h2>The Arena · <span id="arena-season">Season one</span></h2>
      <div class="arena-clock" id="arena-clock">&nbsp;</div>

      <div id="arena-join">
        <label for="arena-input">Pick a name to play under</label>
        <input type="text" id="arena-input" maxlength="18" placeholder="anything you like" autocomplete="off">
        <button class="primary" id="arena-claim">Join the season</button>
        <div class="note">No email, no account, no password. The name is held by this browser, so nobody else can post scores under it — and clearing your browser data loses it.</div>
      </div>

      <div id="arena-you" hidden>
        <div class="row"><span class="muted">Playing as</span><span id="arena-name">—</span></div>
        <div class="row"><span class="muted">Arena balance</span><span id="arena-balance">—</span></div>
        <div class="row"><span class="muted">Up or down</span><span id="arena-change">—</span></div>
        <div class="row"><span class="muted">Trades counted</span><span id="arena-trades">0</span></div>
      </div>

      <div class="arena-note" id="arena-note">Close a trade and it is sent for checking. Your Arena balance is worked out by us, not by this page.</div>
    </div>

    <div class="card">
      <h2>Leaderboard <span class="muted" style="font-weight:400" id="arena-count"></span></h2>
      <div id="arena-board"></div>
      <div class="empty" id="arena-empty">Loading…</div>
    </div>
`;

const STYLES = `
.arena-clock{font-family:var(--mono);font-size:12px;color:var(--amber);margin:-6px 0 10px}
#arena-panel input[type=text]{width:100%;padding:10px 11px;border:1px solid var(--border);border-radius:9px;background:var(--panel2);color:var(--text);font:inherit;font-size:14px}
.arena-note{font-size:11px;color:var(--muted);line-height:1.5;margin-top:10px;padding-top:9px;border-top:1px solid var(--border)}
.arena-note.good{color:var(--green)}
.arena-note.bad{color:var(--amber)}
.lb{display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:8px;padding:7px 6px;border-bottom:1px solid var(--border);font-size:13px}
.lb:last-child{border-bottom:none}
.lb .pos{font-family:var(--mono);font-size:11px;color:var(--muted)}
.lb .who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb .bal{font-family:var(--mono)}
.lb.mine{background:rgba(240,166,58,.08);border-radius:6px}
.lb.mine .who{color:var(--amber);font-weight:600}
.lb.bench{opacity:.85}
.lb.bench .who{color:var(--muted)}
.lb.bench em{display:block;font-style:normal;font-size:10px;color:#6B7480;letter-spacing:.02em}
.lb.bench .bal{color:var(--soft)}
.lb.bot .who{color:var(--soft)}
.lb.bot em{display:block;font-style:normal;font-size:10px;color:#6B7480}
`;

let html = fs.readFileSync('practice/index.html', 'utf8');

const edits = [
    ['<title>Halyard practice — trade with play money at real prices</title>',
        '<title>The Arena — Halyard</title>'],
    ['<a href="./" class="on">Practice</a>', '<a href="../">Practice</a>'],
    ['<a href="../learn/slides/">Guide</a>', '<a href="../learn/slides/">Guide</a>\n    <a href="./" class="on">Arena</a>'],
];

for (const [from, to] of edits) {
    if (!html.includes(from)) {
        console.error(`build-arena: could not find ${from.slice(0, 60)}`);
        process.exit(1);
    }
    html = html.split(from).join(to);
}

// The banner goes once, under the header.
html = html.replace('</header>\n', `</header>\n\n${BANNER}\n`);

// The panel goes at the top of the side column, above the order form.
const sideColumn = '  <div class="side-col">\n';
if (!html.includes(sideColumn)) { console.error('build-arena: no side column'); process.exit(1); }
html = html.replace(sideColumn, `${sideColumn}${PANEL}\n`);

// Styles ride with the page's own.
html = html.replace('/* The guided walkthrough', `${STYLES}\n/* The guided walkthrough`);

// Its scripts live in practice/, and the version query has to survive.
html = html.replace(/<script type="module" src="\.\/app\.js(\?v=\d+)?"><\/script>/,
    (_, v) => `<script type="module" src="../practice/app.js${v ?? ''}"></script>`);

if (!html.includes('../practice/app.js')) { console.error('build-arena: script not rewritten'); process.exit(1); }

fs.mkdirSync('arena', { recursive: true });
fs.writeFileSync('arena/index.html', html);
console.log('arena/index.html rebuilt from practice/index.html');
