// Funding, sourced honestly.
//
// Halyard's own funding rate will come from its own long/short imbalance, and Halyard has no traders
// yet, so a number invented here would teach people to trust a made-up figure. Instead we show the
// live rate from an existing BTC perpetual market, with its own countdown, and name the venue.
// The mechanism is what matters and it is identical: the crowded side pays the other side.
//
// Kraken's futures API refuses browser requests, so these two, which allow them.

const SOURCES = [
    {
        name: 'OKX',
        url: 'https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USD-SWAP',
        read: (j) => {
            const d = j?.data?.[0];
            if (!d) return null;
            return { rate: Number(d.fundingRate) * 100, nextAt: Number(d.nextFundingTime), everyHours: 8 };
        },
    },
    {
        name: 'Bybit',
        url: 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT',
        read: (j) => {
            const d = j?.result?.list?.[0];
            if (!d) return null;
            return { rate: Number(d.fundingRate) * 100, nextAt: Number(d.nextFundingTime), everyHours: 8 };
        },
    },
];

export async function loadFunding() {
    for (const source of SOURCES) {
        try {
            const res = await fetch(source.url);
            if (!res.ok) continue;
            const parsed = source.read(await res.json());
            if (parsed && Number.isFinite(parsed.rate)) return { ...parsed, source: source.name };
        } catch { /* try the next one */ }
    }
    throw new Error('no funding source reachable');
}

export const clock = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return '00:00';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
