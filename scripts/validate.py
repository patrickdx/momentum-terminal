"""Reject broken or unsafe-to-publish snapshots before deployment."""
import json
import math
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'site'
for asset in ('index.html', 'app.js', 'style.css', 'favicon.svg', 'data/latest.json', 'data/history.json'):
    assert (root / asset).is_file(), f'Missing asset: {asset}'
data = json.loads((root / 'data/latest.json').read_text())
assert data['schemaVersion'] == 1
assert set(data['markets']) == {'US', 'CA', 'KR'}
for country, market in data['markets'].items():
    seen = set()
    for s in market['stocks']:
        assert s['id'] not in seen, f'Duplicate listing {s["id"]}'
        seen.add(s['id'])
        assert s['country'] == country
        assert s['price'] > 0 and math.isfinite(s['price'])
        assert s['score'] is None or 0 <= s['score'] <= 100
        assert s['score'] is None or s['coverage'] >= 70
        for news in s['news']:
            assert news['url'].startswith('https://')
assert isinstance(json.loads((root / 'data/history.json').read_text()), list)
print('Static assets and market snapshot validated.')
