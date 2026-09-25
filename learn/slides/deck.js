// The training slides: one walk through a long, one through a short.
//
// Every number is computed from the live BTC price, so a learner sees today's market rather than a
// worked example from a screenshot. Each slide is a function of the price and a few helpers.
//
// Numbers used throughout: 500 USDT of collateral, 5× leverage, 0.06% fee, liquidation at 1% of
// position size, a 0.5% slippage band, and about ten seconds to settle on Trac.

const money = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const m0 = (n) => money(n, 0);

// A long at 5×: liquidation sits below, at the price where collateral runs out bar 1% of the size.
export const longLiq = (p, lev = 5) => p * (1 - (1 - 0.01 * lev) / lev);
export const shortLiq = (p, lev = 5) => p * (1 + (1 - 0.01 * lev) / lev);

export const SLIDES = [
    {
        kind: 'title',
        title: 'How to trade on Halyard',
        sub: 'A long, then a short, with today’s Bitcoin price. About six minutes.',
        body: () => `<p class="lead">Nothing here costs anything. Practice uses play money at live prices, so you can make every mistake on this page rather than with your own money.</p>`,
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
        title: 'The screen, in four parts',
        body: () => `
<div class="grid4">
  <div class="box"><div class="k">Market bar</div><div>Price, 24h change, and funding with a countdown.</div></div>
  <div class="box"><div class="k">Chart</div><div>Candles from one minute to six hours. Your entry and liquidation appear on it once you are in.</div></div>
  <div class="box"><div class="k">Order panel</div><div>Long or short, collateral, leverage, and optional stop-loss.</div></div>
  <div class="box"><div class="k">Positions</div><div>What you hold, what it is worth, and where it would be liquidated.</div></div>
</div>
<p class="note">There is no order book, because Halyard has no limit orders: you trade at the oracle price, matched against the other side.</p>`,
    },

    { kind: 'divider', title: 'Part one: a long', sub: 'Betting the price goes up' },

    {
        title: 'Choosing your size',
        body: (p) => `
<p>Say you put in <strong>500 USDT</strong> of collateral at <strong>5×</strong>. That controls a position of 2,500 USDT, which at ${m0(p)} is about ${(2500 / p).toFixed(6)} BTC.</p>
<div class="two">
  <div class="box"><div class="k">The fee</div><div>0.06% of 2,500, so <strong>1.50 USDT</strong> to open and about the same to close.</div></div>
  <div class="box"><div class="k">The rule</div><div>Leverage multiplies the move, not your luck. A 1% rise is 5% on your collateral; a 1% fall is 5% off it.</div></div>
</div>`,
    },
    {
        title: 'Where you get liquidated',
        body: (p) => `
<p>Your position closes automatically when your collateral is nearly gone: at 1% of the position size, not at zero, so the trader on the other side can still be paid.</p>
<div class="rail">
  <div class="mark high"><div class="v">${m0(p)}</div><div class="k">your entry</div></div>
  <div class="mark low"><div class="v">${m0(longLiq(p))}</div><div class="k">liquidated here</div></div>
</div>
<p>That is about <strong>${(((p - longLiq(p)) / p) * 100).toFixed(1)}%</strong> below where you opened. At 2× it would be roughly ${m0(longLiq(p, 2))}, much further away.</p>
<p class="note">Lower leverage does not mean smaller profits per dollar moved. It means more room before you are out of the trade.</p>`,
    },
    {
        title: 'The worst price you will accept',
        body: (p) => `
<p>Settling on Trac takes about ten seconds, and the price keeps moving in that window. So every order carries a limit.</p>
<div class="two">
  <div class="box"><div class="k">You press at</div><div class="big">${m0(p)}</div></div>
  <div class="box"><div class="k">You will not pay more than</div><div class="big amber">${m0(p * 1.005)}</div><div>0.5%, the standard limit</div></div>
</div>
<p>If the market runs past that while your order is in flight, <strong>nothing opens</strong> and your money stays where it is. Beginners get a tighter 0.3% limit for their first 14 days.</p>`,
    },
    {
        title: 'The ten seconds',
        body: () => `
<p>Most exchanges fill instantly because they hold your money and settle later. Halyard settles on Trac, and you watch it happen.</p>
<ol class="steps">
  <li>You press <span class="pill green">Open 5× long</span></li>
  <li>The order goes out with a signed price attached</li>
  <li>Every node checks that signature</li>
  <li>About ten seconds later it is agreed, or refused for being outside your limit</li>
</ol>
<p class="note">This is the part people find strange, which is exactly why practice makes you sit through it.</p>`,
    },
    {
        title: 'Being in the trade',
        body: (p) => `
<p>While it is open you watch two numbers: what it is worth now, and how far the price is from liquidating you.</p>
<div class="two">
  <div class="box"><div class="k">Price rises 2% to ${m0(p * 1.02)}</div><div class="big green">+50.00 USDT</div><div>10% on your 500</div></div>
  <div class="box"><div class="k">Price falls 2% to ${m0(p * 0.98)}</div><div class="big red">−50.00 USDT</div><div>and liquidation is closer</div></div>
</div>
<p>Closing returns your collateral plus or minus that amount, less the closing fee.</p>`,
    },

    { kind: 'divider', title: 'Part two: a short', sub: 'Betting the price goes down' },

    {
        title: 'Selling something you do not own',
        body: (p) => `
<p>This is the part that confuses people, and the answer is that you never hold Bitcoin either way. A short is simply the opposite contract.</p>
<div class="two">
  <div class="box"><div class="k">You short at</div><div class="big">${m0(p)}</div></div>
  <div class="box"><div class="k">Price falls to ${m0(p * 0.97)}</div><div class="big green">+75.00 USDT</div><div>on 500 at 5×</div></div>
</div>
<p class="note">Nothing was borrowed and nothing was sold on your behalf. A trader on the long side took the other end of the same contract.</p>`,
    },
    {
        title: 'A short is liquidated upwards',
        body: (p) => `
<p>A long dies when the price falls. A short dies when it rises, and the liquidation price sits above your entry.</p>
<div class="rail">
  <div class="mark high"><div class="v">${m0(shortLiq(p))}</div><div class="k">liquidated here</div></div>
  <div class="mark low"><div class="v">${m0(p)}</div><div class="k">your entry</div></div>
</div>
<p>That is about <strong>${(((shortLiq(p) - p) / p) * 100).toFixed(1)}%</strong> above where you opened, at 5×.</p>
<p class="note">Shorts get squeezed in fast rallies for exactly this reason: the losses grow while everyone is buying.</p>`,
    },
    {
        title: 'Funding cuts the other way',
        body: () => `
<p>When most traders are long, longs pay shorts every hour. When most are short, shorts pay longs.</p>
<div class="two">
  <div class="box"><div class="k">Crowded long market</div><div>A short is paid to wait. The market bar shows the rate and the countdown.</div></div>
  <div class="box"><div class="k">Crowded short market</div><div>A short pays for the privilege, and the cost adds up over days.</div></div>
</div>
<p class="note">Funding is not a charge from Halyard. It moves between traders to pull the two sides back into balance.</p>`,
    },

    {
        title: 'Deciding when to get out, in advance',
        body: (p) => `
<p>Set these when you open, while you are calm, rather than in the middle of a fall.</p>
<div class="two">
  <div class="box"><div class="k">Stop-loss, long at ${m0(p)}</div><div class="big red">${m0(p * 0.98)}</div><div>closes you out after a 2% fall, well before liquidation at ${m0(longLiq(p))}</div></div>
  <div class="box"><div class="k">Take-profit</div><div class="big green">${m0(p * 1.03)}</div><div>closes you out on a 3% rise</div></div>
</div>
<p class="note">A stop-loss guarantees the exit, not the price: in a fast market you close at whatever is available.</p>`,
    },
    {
        title: 'The three things that go wrong',
        body: () => `
<div class="grid3">
  <div class="box"><div class="k red">Liquidation</div><div>The price reached your level. You lose what you put in, never more.</div></div>
  <div class="box"><div class="k amber">Refused order</div><div>The price passed your limit while the order settled. Nothing opened; you paid the network fee.</div></div>
  <div class="box"><div class="k amber">Oracle gap</div><div>Prices stop arriving, so the market halts. When it returns, liquidations wait fifteen minutes.</div></div>
</div>
<p class="note">All three are visible in practice. Meeting them here costs nothing.</p>`,
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
