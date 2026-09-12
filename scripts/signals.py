"""Recurring momentum evidence from unique, observed exchange sessions."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import math

SIGNALS = {'strength': 1, 'volume': 2, 'breakout': 4}
BENCHMARKS = {'US': ('SPY', 'America/New_York', 'USD'),
              'CA': ('XIU.TO', 'America/Toronto', 'CAD'),
              'KR': ('^KS11', 'Asia/Seoul', 'KRW')}


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def signal_masks(stock):
    """[known inputs, fired signals]; missing is distinct from a negative signal."""
    known = hits = 0
    checks = [(1, ['score'], lambda: stock['score'] >= 80),
              (2, ['rvol', 'day'], lambda: stock['rvol'] >= 2 and stock['day'] > 0),
              (4, ['nearHigh', 'rvol'], lambda: stock['nearHigh'] >= .97 and stock['rvol'] >= 1.3)]
    for bit, keys, predicate in checks:
        if all(number(stock.get(k)) for k in keys):
            known |= bit
            if predicate():
                hits |= bit
    return [known, hits]


def closed_session(response, country, collected_at):
    """Use an exchange-local benchmark session, never a calendar-day counter."""
    result = response['chart']['result'][0]
    meta = result['meta']
    _, zone, currency = BENCHMARKS[country]
    if meta.get('currency') != currency or meta.get('exchangeTimezoneName') != zone:
        raise ValueError('Benchmark market mismatch')
    collected = datetime.fromisoformat(collected_at)
    quote = datetime.fromtimestamp(meta['regularMarketTime'], timezone.utc)
    if not 0 <= (collected - quote).total_seconds() <= 7 * 86400:
        raise ValueError('Benchmark timestamp stale or ahead of scan')
    stamp = result['timestamp'][-1]
    session = datetime.fromtimestamp(stamp, ZoneInfo(zone)).date()
    if quote.astimezone(ZoneInfo(zone)).date() != session or session.weekday() >= 5:
        raise ValueError('Benchmark quote and daily bar do not agree')
    # A manual run during the regular session is not a completed daily observation.
    period = meta['currentTradingPeriod']['regular']
    if datetime.fromtimestamp(period['start'], ZoneInfo(zone)).date() == session:
        if collected.timestamp() < period['end'] + 15 * 60:
            raise ValueError('Regular session has not settled')
    return session.isoformat()


def summarize(trail):
    current = trail[-1] if trail else None
    counts, streaks, renewed = [], [], False
    for bit in SIGNALS.values():
        count = sum(bool(row and row[0] & bit and row[1] & bit) for row in trail)
        streak = 0
        for row in reversed(trail):
            if not row or not row[0] & bit or not row[1] & bit:
                break
            streak += 1
        active = bool(current and current[0] & bit and current[1] & bit)
        counts.append(count if active else 0)
        streaks.append(streak)
        # Unknown/missing previous inputs do not establish an off -> on transition.
        prior = trail[-2] if len(trail) > 1 else None
        if active and prior and prior[0] & bit and not prior[1] & bit and count >= 2:
            renewed = True
    return {'repeatCount': max(counts, default=0), 'signalStreak': max(streaks, default=0),
            'recurring': max(counts, default=0) >= 3, 'renewed': renewed,
            'observedSessions': sum(bool(row and row[0]) for row in trail), 'signalTrail': trail}


def update_market(market, records, session=None):
    """Append each completed session once and retain the latest 90 sessions."""
    records = sorted(records, key=lambda r: r['date'])
    if session and market['status'] == 'ok':
        # Once a session has been observed, weekend/holiday reruns must not change it.
        if not records or session > records[-1]['date']:
            records.append({'date': session, 'stocks': {s['id']: signal_masks(s) for s in market['stocks']}})
        records = sorted(records, key=lambda r: r['date'])[-90:]
    window = records[-10:]
    market['signalSessions'] = [r['date'] for r in window]
    market['signalAsOf'] = window[-1]['date'] if window else None
    market['signalCurrent'] = bool(session and window and session == window[-1]['date'] and market['status'] == 'ok')
    for stock in market['stocks']:
        stock.update(summarize([r['stocks'].get(stock['id']) for r in window]))
        # Preserve historical evidence but don't report an unverified current signal.
        if not market['signalCurrent']:
            stock['recurring'] = stock['renewed'] = False
    return records
