"""Reject broken or unsafe-to-publish snapshots before deployment."""
import json
import math
from signals import summarize
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'site'
for asset in ('index.html', 'app.js', 'style.css', 'favicon.svg', 'vendor/echarts/echarts-6.0.0.min.js', 'vendor/echarts/LICENSE', 'vendor/echarts/NOTICE', 'data/latest.json', 'data/history.json', 'data/recent.json', 'data/signals.json'):
    assert (root / asset).is_file(), f'Missing asset: {asset}'
data = json.loads((root / 'data/latest.json').read_text())
assert data['schemaVersion'] == 2
assert set(data['markets']) == {'US', 'CA', 'KR'}
for country, market in data['markets'].items():
    dates = market.get('signalSessions', [])
    assert len(dates) <= 10 and dates == sorted(set(dates))
    seen = set()
    for s in market['stocks']:
        assert s['id'] not in seen, f'Duplicate listing {s["id"]}'
        seen.add(s['id'])
        assert s['country'] == country
        assert s['price'] > 0 and math.isfinite(s['price'])
        assert s['score'] is None or 0 <= s['score'] <= 100
        assert s['score'] is None or s['coverage'] >= 70
        if market['status'] == 'ok':
            assert s['marketCapCurrency'] == 'USD'
            assert s['marketCapUsd'] is None or s['marketCapUsd'] > 0
            assert s['themes'] == [s.get('industry') or 'Unclassified']
        trail = s.get('signalTrail', [])
        assert len(trail) == len(dates)
        for row in trail:
            assert row is None or (len(row) == 2 and all(isinstance(v, int) and 0 <= v <= 7 for v in row) and row[1] & ~row[0] == 0)
        expected = summarize(trail)
        assert s['repeatCount'] == expected['repeatCount']
        assert s['recurring'] == (expected['recurring'] and market['signalCurrent'])
        assert s['renewed'] == (expected['renewed'] and market['signalCurrent'])
        for news in s['news']:
            assert news['url'].startswith('https://')
assert isinstance(json.loads((root / 'data/history.json').read_text()), list)
archive = json.loads((root / 'data/signals.json').read_text())
assert archive['version'] == 1
for country, records in archive['markets'].items():
    dates = [r['date'] for r in records]
    assert len(records) <= 90 and dates == sorted(set(dates))
    assert data['markets'][country]['signalSessions'] == dates[-10:]
print('Static assets and market snapshot validated.')
