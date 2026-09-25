// The training slides: the whole trade, start to finish, twice — once long and once short.
//
// Every number is computed from the live BTC price, so a learner sees today's market rather than a
// worked example from a screenshot. Each slide is a function of that price.
//
// The worked example throughout: 500 USDT of collateral at 5×, a 2,500 USDT position, 0.06% fee each
// way, liquidation at 1% of position size, a slippage band the trader picks, ten seconds to settle.

const money = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const m0 = (n) => money(n, 0);

const COLLATERAL = 500;
const LEV = 5;
const SIZE = COLLATERAL * LEV;
const FEE = SIZE * 0.0006;

// A long at 5×: liquidation sits below, at the price where collateral runs out bar 1% of the size.
export const longLiq = (p, lev = LEV) => p * (1 - (1 - 0.01 * lev) / lev);
export const shortLiq = (p, lev = LEV) => p * (1 + (1 - 0.01 * lev) / lev);

export const SLIDES = [
    {
        kind: 'title',
        title: 'How to trade on Halyard',
        sub: 'The whole thing, twice: once long, once short. About ten minutes.',
        body: () => `<p class="lead">Nothing here costs anything. Practice uses play money at live prices, so you can make every mistake on this page rather than with your own money.</p>
<p class="note">You will finish knowing what every control does: collateral, leverage, the price you accept, stop-loss, take-profit, and what closing actually pays you.</p>`,
    },
    {
        title: 'What you are actually trading',
        body: (p) => `
<p>You are not buying Bitcoin. You open a contract that follows its price, matched against a trader taking the other side.</p>
<div class="two">
  <div class="box"><div class="k">If you go long at ${m0(p)}</div><div>You gain when the price rises, and the trader on the short side loses the same amount.</div></div>
  <div class="box"><div class="k">If you go short at ${m0(p)}</div><div>You gain when the price falls, and the long side loses the same amount.</div></div>
</div>
<p class="note">Nothing is lent to you, and there is no pool paying the winners. Every dollar you make comes from the other side of your trade.</p>`,
    },
    {
        title: 'Who is on the other side',
        body: (p) => `
<p>An order book exists to <em>discover</em> a price. Halyard imports one instead — Pyth publishes it, every node checks the signature — so there is nothing to haggle over and no queue of bids and offers to read. Matching is about <strong>quantity</strong>, not price.</p>
<p>Open a 5× long on ${money(COLLATERAL)} at ${m0(p)} and the contract needs ${(SIZE / p).toFixed(4)} BTC of short against it. Not from one person: five traders shorting ${m0(COLLATERAL)} each will do. Your position faces the book, never a human you could name.</p>
<table>
  <tr><th>What someone does</th><th>Effect on the book</th></tr>
  <tr><td>Opens a long</td><td class="green">+</td></tr>
  <tr><td>Closes a short</td><td class="green">+</td></tr>
  <tr><td>Opens a short</td><td class="red">−</td></tr>
  <tr><td>Closes a long</td><td class="red">−</td></tr>
</table>
<p class="note">A match pairs a <span class="green">+</span> with a <span class="red">−</span>, so you are never waiting for the person you opened against — anyone moving the book the other way will do. When the two sides do not balance, the unpopular side fills freely, the crowded side fills as far as the insurance fund can back it, and the rest <strong>waits rather than filling at a bad price</strong>. Funding is what pays someone to take the quiet side. <a href="../simulation/">Watch it happen →</a></p>`,
    },
    {
        title: 'The screen, in five parts',
        body: () => `
<div class="grid4">
  <div class="box"><div class="k">Market bar</div><div>Price, 24h change, and funding with a countdown to when it is charged.</div></div>
  <div class="box"><div class="k">Chart</div><div>Candles from one minute to six hours. Your entry, liquidation, stop-loss and take-profit are drawn on it.</div></div>
  <div class="box"><div class="k">Order panel</div><div>Side, collateral, leverage, the worst price you accept, and your exits.</div></div>
  <div class="box"><div class="k">Ladder</div><div>What a long and a short of your size are worth at each price, longs left and shorts right.</div></div>
  <div class="box"><div class="k">Positions</div><div>What you hold, what it is worth right now, and where it would be liquidated.</div></div>
</div>
<p class="note">None of that is an order book: Halyard has no limit orders, so there are no resting bids and offers to show. You trade at the oracle price, matched against the other side.</p>`,
    },

    {
        title: 'Reading the ladder',
        body: (p) => `
<p>The column beside the chart is where another exchange puts its order book. Ours holds something real instead: <strong>what a long and a short of your size are worth at every price near this one</strong>.</p>
<div class="rail">
  <div class="mark high"><div class="v green">+${money(SIZE * 0.014)}</div><div class="k">${m0(p * 1.014)} — a long is up this much here, and a short is down the same</div></div>
  <div class="mark"><div class="v amber">${m0(p)}</div><div class="k">the price right now, highlighted</div></div>
  <div class="mark low"><div class="v red">−${money(SIZE * 0.014)}</div><div class="k">${m0(p * 0.986)} — now the long is down and the short is up</div></div>
</div>
<p>The two sides are exact mirrors, to the cent, because that is what a matched book <em>is</em>: your gain is the money the other side lost.</p>
<p class="note"><strong>Use it to set your exits.</strong> Find a loss on the left you could live with, read the price beside it — that is where your stop-loss goes. Do the same with a gain for your take-profit. The rungs are 0.35% apart and cover about 3% either way, so this is the next hour or two, not where liquidation sits: that is marked on the chart.</p>`,
    },

    { kind: 'divider', title: 'Part one: a long', sub: 'Betting the price goes up' },

    {
        title: 'Collateral: the money you put at risk',
        body: () => `
<p>Collateral is what you commit to this one trade. It is taken out of your balance while the trade is open, and it is <strong>the most you can lose</strong>, whatever happens to the price.</p>
<div class="two">
  <div class="box"><div class="k">Your balance</div><div class="big">10,000.00</div><div>play USDT, yours to spend across as many trades as you like</div></div>
  <div class="box"><div class="k">This trade</div><div class="big amber">${money(COLLATERAL)}</div><div>committed now, returned with profit or loss when you close</div></div>
</div>
<p class="note">The size buttons — 25%, 50%, 75%, Max — fill this in from your balance. Nobody serious puts Max into one trade.</p>`,
    },
    {
        title: 'Leverage: the multiplier, and the catch',
        body: (p) => `
<p>Leverage decides how big a position your ${money(COLLATERAL)} controls. At 5× it controls ${m0(SIZE)} USDT, which at ${m0(p)} is about ${(SIZE / p).toFixed(6)} BTC.</p>
<table>
  <tr><th>Leverage</th><th>Position</th><th>A 1% rise</th><th>Liquidated at</th></tr>
  <tr><td>2×</td><td>${m0(COLLATERAL * 2)}</td><td class="green">+${money(COLLATERAL * 2 * 0.01)}</td><td>${m0(longLiq(p, 2))}</td></tr>
  <tr><td>5×</td><td>${m0(COLLATERAL * 5)}</td><td class="green">+${money(COLLATERAL * 5 * 0.01)}</td><td>${m0(longLiq(p, 5))}</td></tr>
</table>
<p class="note">The profit column is why people reach for leverage. The last column is the price you pay for it: 5× puts the exit four times closer.</p>`,
    },
    {
        title: 'Where you get liquidated',
        body: (p) => `
<p>Your position closes automatically when your collateral is nearly gone: at 1% of the position size, not at zero, so the trader on the other side can still be paid.</p>
<div class="rail">
  <div class="mark high"><div class="v">${m0(p)}</div><div class="k">your entry</div></div>
  <div class="mark low"><div class="v">${m0(longLiq(p))}</div><div class="k">liquidated here — collateral gone</div></div>
</div>
<p>That is <strong>${(((p - longLiq(p)) / p) * 100).toFixed(1)}%</strong> below where you opened, at 5×.</p>
<p class="note">This number is on screen before you press the button, and drawn on the chart once you are in. If it looks close, your leverage is too high.</p>`,
    },
    {
        title: 'The worst price you will accept',
        body: (p) => `
<p>Settling on Trac takes about ten seconds, and the price keeps moving in that window. So you choose a limit, and the contract will not fill you past it.</p>
<div class="grid3">
  <div class="box"><div class="k">0.1% — tight</div><div class="big">${m0(p * 1.001)}</div><div>Rarely surprises you. More orders refused in a fast market.</div></div>
  <div class="box"><div class="k">0.25% — middle</div><div class="big">${m0(p * 1.0025)}</div><div>A sensible default for a calm market.</div></div>
  <div class="box"><div class="k amber">0.5% — loose</div><div class="big amber">${m0(p * 1.005)}</div><div>Almost always fills. You accept up to ${money(SIZE * 0.005)} worse on ${m0(SIZE)}.</div></div>
</div>
<p class="note">If the market runs past your limit while the order is in flight, <strong>nothing opens</strong> and your money stays where it is.</p>`,
    },
    {
        title: 'The ten seconds',
        body: () => `
<p>Most exchanges fill instantly because they hold your money and settle later. Halyard settles on Trac, and you watch it happen.</p>
<ol class="steps">
  <li>You press <span class="pill green">Open 5× long</span></li>
  <li>The order goes out with a signed price attached</li>
  <li>Every node checks that signature</li>
  <li>About ten seconds later it is agreed — or refused for being outside your limit</li>
  <li>Then it waits, if it has to, for a trader taking the other side</li>
</ol>
<p class="note">This is the part people find strange, which is exactly why practice makes you sit through it.</p>`,
    },
    {
        title: 'Being in the trade',
        body: (p) => `
<p>Profit and loss moves with every tick. On ${m0(SIZE)} of position, every 1% of price is ${money(SIZE * 0.01)} — 5% of your collateral.</p>
<div class="two">
  <div class="box"><div class="k">Price rises 2% to ${m0(p * 1.02)}</div><div class="big green">+${money(SIZE * 0.02)}</div><div>+10% on your ${money(COLLATERAL)}</div></div>
  <div class="box"><div class="k">Price falls 2% to ${m0(p * 0.98)}</div><div class="big red">−${money(SIZE * 0.02)}</div><div>−10%, and liquidation is closer</div></div>
</div>
<p class="note">Nothing is settled while you sit there. It becomes real money only when the position closes.</p>`,
    },
    {
        title: 'Closing, and what actually lands in your balance',
        body: (p) => `
<p>Press Close and the position ends at the current price. Your collateral comes back, plus the profit or minus the loss, less the fee.</p>
<table>
  <tr><th></th><th>Amount</th></tr>
  <tr><td>Collateral committed</td><td>${money(COLLATERAL)}</td></tr>
  <tr><td>Profit, closing 2% up at ${m0(p * 1.02)}</td><td class="green">+${money(SIZE * 0.02)}</td></tr>
  <tr><td>Fee to open (0.06% of ${m0(SIZE)})</td><td class="red">−${money(FEE)}</td></tr>
  <tr><td>Fee to close</td><td class="red">−${money(FEE * 1.02)}</td></tr>
  <tr><td><strong>Back in your balance</strong></td><td><strong>${money(COLLATERAL + SIZE * 0.02 - FEE - FEE * 1.02)}</strong></td></tr>
</table>
<p class="note">Two fees per round trip, both on the position size rather than your collateral. That is the whole cost of trading here.</p>`,
    },

    { kind: 'divider', title: 'Part two: a short', sub: 'Betting the price goes down' },

    {
        title: 'Selling something you do not own',
        body: (p) => `
<p>This is the part that confuses people, and the answer is that you never hold Bitcoin either way. A short is simply the opposite contract.</p>
<div class="two">
  <div class="box"><div class="k">You short at</div><div class="big">${m0(p)}</div><div>same ${money(COLLATERAL)}, same 5×</div></div>
  <div class="box"><div class="k">Price falls 3% to ${m0(p * 0.97)}</div><div class="big green">+${money(SIZE * 0.03)}</div><div>+15% on your collateral</div></div>
</div>
<p class="note">Nothing was borrowed and nothing was sold on your behalf. A trader on the long side took the other end of the same contract.</p>`,
    },
    {
        title: 'A short is liquidated upwards',
        body: (p) => `
<p>A long dies when the price falls. A short dies when it rises, so everything you just learned flips over.</p>
<div class="rail">
  <div class="mark high"><div class="v">${m0(shortLiq(p))}</div><div class="k">liquidated here</div></div>
  <div class="mark low"><div class="v">${m0(p)}</div><div class="k">your entry</div></div>
</div>
<p>That is <strong>${(((shortLiq(p) - p) / p) * 100).toFixed(1)}%</strong> above where you opened, at 5×. Your worst acceptable price also flips: ${m0(p * 0.995)} at a 0.5% band, because a short wants to sell high.</p>
<p class="note">Shorts get squeezed in fast rallies for exactly this reason: the losses grow while everyone is buying.</p>`,
    },
    {
        title: 'Funding cuts the other way',
        body: () => `
<p>When most traders are long, longs pay shorts every hour. When most are short, shorts pay longs. The market bar shows the rate and counts down to the charge.</p>
<div class="two">
  <div class="box"><div class="k">Crowded long market</div><div>A short is <span class="green">paid to wait</span>. Holding costs you nothing and earns a trickle.</div></div>
  <div class="box"><div class="k">Crowded short market</div><div>A short <span class="red">pays</span> for the privilege, and over days it adds up against you.</div></div>
</div>
<p class="note">Funding is not a charge from Halyard. It moves between traders to pull the two sides back into balance.</p>`,
    },

    { kind: 'divider', title: 'Part three: deciding in advance', sub: 'The two settings that save people from themselves' },

    {
        title: 'Stop-loss: where you admit you were wrong',
        body: (p) => `
<p>A stop-loss closes the position automatically if the price reaches a level you choose. You set it while you are calm, so the decision is not made mid-fall.</p>
<table>
  <tr><th>Stop on a long at ${m0(p)}</th><th>Price</th><th>You lose</th><th>Of your ${money(COLLATERAL)}</th></tr>
  <tr><td>1% away — tight</td><td>${m0(p * 0.99)}</td><td class="red">−${money(SIZE * 0.01)}</td><td>5%</td></tr>
  <tr><td>2% away — usual</td><td>${m0(p * 0.98)}</td><td class="red">−${money(SIZE * 0.02)}</td><td>10%</td></tr>
  <tr><td>3% away — loose</td><td>${m0(p * 0.97)}</td><td class="red">−${money(SIZE * 0.03)}</td><td>15%</td></tr>
  <tr><td>No stop</td><td>${m0(longLiq(p))}</td><td class="red">−${money(COLLATERAL)}</td><td>100%</td></tr>
</table>
<p class="note">Put it where the trade is <em>wrong</em>, not where it is uncomfortable. Too tight and ordinary noise closes a trade that was fine.</p>`,
    },
    {
        title: 'Take-profit: where you stop being greedy',
        body: (p) => `
<p>The mirror image: it closes the position when the price reaches your target, whether or not you are watching.</p>
<table>
  <tr><th>Target on a long at ${m0(p)}</th><th>Price</th><th>You gain</th><th>Of your ${money(COLLATERAL)}</th></tr>
  <tr><td>2%</td><td>${m0(p * 1.02)}</td><td class="green">+${money(SIZE * 0.02)}</td><td>10%</td></tr>
  <tr><td>3%</td><td>${m0(p * 1.03)}</td><td class="green">+${money(SIZE * 0.03)}</td><td>15%</td></tr>
  <tr><td>5%</td><td>${m0(p * 1.05)}</td><td class="green">+${money(SIZE * 0.05)}</td><td>25%</td></tr>
</table>
<p class="note">Most losing traders are right about direction and wrong about when to leave. This is the fix, and it costs nothing to set.</p>`,
    },
    {
        title: 'Both at once: the bracket',
        body: (p) => `
<p>Set both and the trade has an exit in each direction before it starts. Both are drawn on the chart, so you can see the whole trade at a glance.</p>
<div class="rail">
  <div class="mark high"><div class="v">${m0(p * 1.03)}</div><div class="k">take-profit · +${money(SIZE * 0.03)}</div></div>
  <div class="mark"><div class="v">${m0(p)}</div><div class="k">entry</div></div>
  <div class="mark low"><div class="v">${m0(p * 0.98)}</div><div class="k">stop-loss · −${money(SIZE * 0.02)}</div></div>
  <div class="mark low"><div class="v">${m0(longLiq(p))}</div><div class="k">liquidation · −${money(COLLATERAL)} — you never get here</div></div>
</div>
<p class="note">Risking ${money(SIZE * 0.02)} to make ${money(SIZE * 0.03)} means you can be wrong more often than right and still come out ahead. A stop-loss guarantees the exit, not the exact price.</p>`,
    },

    {
        title: 'The three things that go wrong',
        body: () => `
<div class="grid3">
  <div class="box"><div class="k red">Liquidation</div><div>The price reached your level and the position is gone. You lose what you put in, never more.</div></div>
  <div class="box"><div class="k amber">Refused order</div><div>The price passed the limit you chose while the order settled. Nothing opened; you paid the network fee.</div></div>
  <div class="box"><div class="k amber">Oracle gap</div><div>Prices stop arriving, so the market halts. When it returns, liquidations wait fifteen minutes.</div></div>
</div>
<p class="note">All three are visible in practice, on purpose. Meeting them here costs nothing.</p>`,
    },
    {
        title: 'Your first trade, in six presses',
        body: () => `
<ol class="steps">
  <li><strong>Long</strong> or <strong>Short</strong> — which way you think it goes</li>
  <li><strong>Collateral</strong> — start at 100, not Max</li>
  <li><strong>Leverage</strong> — start at 2×, where liquidation is far away</li>
  <li><strong>Worst price</strong> — 0.25% is a fine default</li>
  <li><strong>Stop-loss</strong> 2% away, <strong>take-profit</strong> 3% away</li>
  <li><strong>Open</strong> — then sit through the ten seconds</li>
</ol>
<p class="note">Press "Show me around" on the trading screen and it walks you through those six, pointing at each control as you go.</p>`,
    },
    {
        kind: 'end',
        title: 'Now do it with play money',
        sub: 'Ten thousand of it, at the price you just saw.',
        body: () => `
<p class="lead">Open a long. Open a short. Set a stop-loss and watch it fire. Then put 5× on a small position and let it get liquidated on purpose, so the first time is not with your own money.</p>
<div class="cta"><a class="btn" href="../../">Open the trading screen</a><a class="btn ghost" href="../">Back to the lessons</a></div>`,
    },
];
