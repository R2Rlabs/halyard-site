// Generates index.html (the front door) from practice/index.html.
//
// The two pages are the same trading screen; the home page differs only in its title, its navigation
// paths and the practice banner above the market bar. Keeping that delta here, rather than in
// somebody's shell history, is what stops old copy creeping back in on the next sync.
//
//   node build-home.js
//
// Run it after copying a new practice/index.html in, then commit both.

const fs = require('fs');

const BANNER = '<div class="strip"><strong>Practice mode</strong> '
    + '<span>Play money at live prices. Nothing here is a deposit, and nothing can be won or lost.</span> '
    + '<a href="./about/">Real trading is not open yet &mdash; how it will work &rarr;</a></div>';

const EDITS = [
    ['<title>Halyard practice — trade with play money at real prices</title>',
        '<title>Halyard — practice perpetual futures with play money at live prices</title>'],
    ['<a class="brand" href="../">', '<a class="brand" href="./">'],
    ['<a href="./" class="on">Practice</a>', '<a href="./" class="on">Trade</a>'],
    ['<a href="../learn/slides/">Guide</a>', '<a href="./learn/slides/">Guide</a>'],
    ['<a href="../learn/">Learn</a>', '<a href="./learn/">Learn</a>'],
    ['<a href="../">About</a>', '<a href="./about/">About</a>'],
];

let html = fs.readFileSync('practice/index.html', 'utf8');

for (const [from, to] of EDITS) {
    if (!html.includes(from)) {
        console.error(`build-home: could not find ${from.slice(0, 60)}`);
        process.exit(1);
    }
    html = html.split(from).join(to);
}

// The banner goes once, directly under the header.
html = html.replace('</header>\n', `</header>\n\n${BANNER}\n`);

// The page's own scripts live in practice/, and the version query has to survive.
html = html.replace(/<script type="module" src="\.\/app\.js(\?v=\d+)?"><\/script>/,
    (_, v) => `<script type="module" src="./practice/app.js${v ?? ''}"></script>`);

if (!html.includes('./practice/app.js')) {
    console.error('build-home: script tag not rewritten');
    process.exit(1);
}

fs.writeFileSync('index.html', html);
console.log('index.html rebuilt from practice/index.html');
