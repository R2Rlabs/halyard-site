// The six lessons. Content lives here as data so the page stays a renderer.
//
// Rules that shaped these: every lesson is short enough to finish, uses the live price so the numbers
// are real, and ends with something to do rather than something to agree with. Nothing claims trading
// is easy, and the losing cases are as prominent as the winning ones.

export const LESSONS = [
    {
        id: 'not-spot',
        title: 'You are not buying Bitcoin',
        minutes: 2,
        body: (p) => `
<p>On Halyard you never own BTC. You open a <strong>contract</strong> that tracks its price, and that contract is matched against another trader who took the opposite side.</p>
<p>If BTC is ${p} and you open a long, someone else opened a short at the same price. When you make 100 USDT, they lose 100 USDT. There is no pool paying you, no company on the other side, and nothing to withdraw as Bitcoin.</p>
<p>This matters because it changes what can go wrong. A spot buyer who is wrong waits. A trader here who is wrong runs out of collateral and the position ends.</p>`,
        check: {
            question: 'You open a 5× long and the price rises. Where does your profit come from?',
            options: ['Halyard pays it', 'New buyers pay it', 'The traders on the short side', 'Interest on your deposit'],
            answer: 2,
            why: 'Every long is matched against a short. Their loss is your gain, and yours is theirs.',
        },
    },
    {
        id: 'leverage',
        title: 'What leverage actually does',
        minutes: 3,
        body: (p, calc) => `
<p>Leverage multiplies both directions. With 500 USDT at 5×, you control ${calc(500, 5)} USDT of BTC at ${p}.</p>
<table>
  <tr><th>Leverage</th><th>Your 500 controls</th><th>A 10% fall costs you</th><th>Wiped out by a fall of</th></tr>
  <tr><td>1×</td><td>500</td><td>50 (10%)</td><td>99%</td></tr>
  <tr><td>2×</td><td>1,000</td><td>100 (20%)</td><td>49%</td></tr>
  <tr><td>5×</td><td>2,500</td><td>250 (50%)</td><td>19%</td></tr>
  <tr><td>50× <span class="muted">(elsewhere)</span></td><td>25,000</td><td>2,500 (everything)</td><td>1.9%</td></tr>
</table>
<p>That last row is why Halyard stops at 5×. At 50×, an ordinary Tuesday takes everything.</p>`,
        check: {
            question: 'At 5×, roughly how far does the price have to move against you to wipe out your collateral?',
            options: ['About 1%', 'About 5%', 'About 19%', 'About 50%'],
            answer: 2,
            why: 'Your collateral is a fifth of the position, so a fifth of a move against you takes all of it. Liquidation comes slightly earlier.',
        },
    },
    {
        id: 'liquidation',
        title: 'Liquidation happens before you reach zero',
        minutes: 3,
        body: (p, calc, liq) => `
<p>If your losses ate every last cent of collateral, the trader on the other side would not get paid. So positions are closed while something is still left: at <strong>1% of the position size</strong>.</p>
<p>A 500 USDT long at 5×, opened at ${p}, is liquidated at about <strong>${liq(5)}</strong>. At 2× it would be <strong>${liq(2)}</strong>, much further away.</p>
<p>When it happens you lose what you put in, not more. It is quick, it is automatic, and nobody asks first. This is the single most important thing to feel before you use real money.</p>`,
        check: {
            question: 'Why does liquidation happen before your collateral reaches zero?',
            options: ['To charge more fees', 'So the winning trader can be paid in full', 'Because the price feed is slow', 'To force you to trade again'],
            answer: 1,
            why: 'The other side of your trade is owed their profit. Closing early is what makes that possible.',
        },
    },
    {
        id: 'funding',
        title: 'Funding: the crowded side pays',
        minutes: 2,
        body: () => `
<p>When far more people want to be long than short, longs pay a small fee every hour to the shorts. When shorts are crowded, it flows the other way.</p>
<p>It is not a charge from us. It moves between traders, and it exists to pull the two sides back into balance so the market can keep matching.</p>
<p>It is small per hour and adds up over days. A position held for a week on the crowded side can pay meaningfully more than the trading fee.</p>`,
        check: {
            question: 'Most traders are long and you are short. What happens to your position?',
            options: ['You pay funding every hour', 'You receive funding every hour', 'Nothing, funding is only for longs', 'Your leverage rises'],
            answer: 1,
            why: 'The crowded side pays the scarce side. Being on the unpopular side earns funding.',
        },
    },
    {
        id: 'stop-loss',
        title: 'A stop-loss is a decision made while calm',
        minutes: 2,
        body: () => `
<p>A stop-loss closes your position automatically at a price you choose. You set it when you are thinking clearly, so that a bad hour cannot talk you into waiting.</p>
<p>It does not guarantee the price: in a fast fall your position closes at whatever is available, which can be worse than the level you set.</p>
<p>Halyard requires you to place one in practice before you can deposit. Not because it is magic, but because people who have never used one tend to hold losing positions too long.</p>`,
        check: {
            question: 'What does a stop-loss guarantee?',
            options: ['The exact price you chose', 'That you cannot lose money', 'That the position closes, at whatever price is available', 'A refund of your fees'],
            answer: 2,
            why: 'It guarantees the exit, not the price. In a fast market the fill can be worse than your level.',
        },
    },
    {
        id: 'waiting',
        title: 'Ten seconds, and what protects you in them',
        minutes: 3,
        body: (p, calc, liq, band) => `
<p>Halyard settles on Trac, and that takes about ten seconds. The price keeps moving while your order fills, so you tell us the worst price you will accept.</p>
<p>At ${p} with the standard 0.5% limit, a long fills at no worse than <strong>${band(0.005)}</strong>. If the market passes that while your order is in flight, <strong>nothing opens</strong> and your money stays where it is.</p>
<p>Beginners get a tighter 0.3% limit for their first 14 days. You can make yours tighter, never looser.</p>
<p>When things really break — the price feed stops — the market stops with it, and liquidations wait fifteen minutes after it returns so you have a chance to react.</p>`,
        check: {
            question: 'Your order is filling and the price shoots past your limit. What happens?',
            options: ['It fills at the new price', 'It fills at your limit', 'Nothing opens and you keep your money', 'It becomes a market order'],
            answer: 2,
            why: 'Outside your limit, the fill does not happen. A refused order costs the network fee and opens nothing.',
        },
    },
];
