// Funding, sourced honestly.
//
// Halyard's own funding rate will come from its own long/short imbalance, and Halyard has no traders
// yet, so inventing a number here would teach people to trust a made-up figure. Instead we show the
// live rate from an existing BTC perpetual market (Kraken's PI_XBTUSD) and say where it came from.
// The mechanism is identical: the crowded side pays the other side, hourly.

const TICKERS = 'https://futures.kraken.com/derivatives/api/v3/tickers';

export async function loadFunding() {
    const res = await fetch(TICKERS);
    if (!res.ok) throw new Error(`funding HTTP ${res.status}`);
    const json = await res.json();
    const t = (json.tickers || []).find((x) => x.symbol === 'PI_XBTUSD');
    if (!t) throw new Error('no BTC perp in the feed');
    // Kraken quotes the rate in quote currency per unit of base, per hour.
    const perHourPct = (t.fundingRate * t.markPrice) * 100;
    const nextPct = (t.fundingRatePrediction * t.markPrice) * 100;
    return { perHourPct, nextPct, source: 'Kraken BTC perp' };
}

// Funding is charged on the hour, so the countdown is simply time until the next one.
export function secondsToNextHour() {
    const now = new Date();
    return 3600 - (now.getMinutes() * 60 + now.getSeconds());
}

export const clock = (seconds) => {
    const m = Math.floor(seconds / 60), s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
