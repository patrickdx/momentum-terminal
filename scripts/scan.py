#!/usr/bin/env python3
"""Daily snapshots. Standard library only; no secrets or requests in the browser."""
import argparse
import bisect
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import io
import json
import math
import os
from pathlib import Path
import re
import statistics
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'site' / 'data'
COUNTRIES = {'US': 'america', 'CA': 'canada', 'KR': 'korea'}
COLUMNS = ['name', 'description', 'close', 'change', 'volume', 'Perf.W', 'Perf.1M',
           'Perf.3M', 'relative_volume_10d_calc', 'SMA20', 'SMA50', 'SMA200',
           'price_52_week_high', 'market_cap_basic', 'sector', 'industry', 'currency',
           'RSI', 'earnings_release_next_date', 'price_earnings_ttm',
           'total_revenue_yoy_growth_ttm', 'average_volume_10d_calc', 'exchange']
FIELDS = ['symbol', 'name', 'price', 'day', 'volume', 'week', 'month', 'quarter',
          'rvol', 'sma20', 'sma50', 'sma200', 'high52', 'marketCap', 'sector',
          'industry', 'currency', 'rsi', 'earnings', 'pe', 'revenueGrowth', 'avgVolume', 'exchange']
WEIGHTS = {'month': 25, 'quarter': 25, 'week': 15, 'rvol': 15, 'trend': 10, 'nearHigh': 10}
THEMES = {
    'AI & semiconductors': ['semiconductor', 'artificial intelligence', 'data center', 'datacenter', 'hbm', 'gpu', '반도체', '인공지능'],
    'Power & nuclear': ['uranium', 'nuclear', 'electric utilities', 'electrical products', 'power generation', '원전', '전력'],
    'Gold & critical minerals': ['gold', 'silver', 'copper', 'rare earth', 'precious metals', 'lithium', '희토류'],
    'Defense & aerospace': ['aerospace', 'defense', 'defence', 'space launch', 'satellite', '방산', '우주'],
    'Energy & shipping': ['oil & gas', 'oil and gas', 'drilling', 'marine shipping', 'shipbuilding', 'lng', '조선'],
    'Biotech & healthcare': ['biotechnology', 'pharmaceutical', 'medical specialties', 'clinical trial', 'fda', '바이오'],
    'Digital economy': ['software', 'internet', 'cybersecurity', 'e-commerce', 'blockchain', 'crypto', 'fintech'],
    'Electrification': ['electric vehicle', 'battery', 'batteries', 'renewable', 'solar', '배터리', '전기차'],
    'Financials': ['banks', 'insurance', 'investment banks', 'finance', '은행'],
    'Consumer & industrials': ['retail', 'consumer', 'industrial', 'machinery', 'transportation', 'construction'],
}
OVERRIDES = {'NASDAQ:NVDA': ['AI & semiconductors'], 'NASDAQ:PLTR': ['AI & semiconductors', 'Defense & aerospace'],
             'NYSE:CCJ': ['Power & nuclear'], 'TSX:CCO': ['Power & nuclear'],
             'NASDAQ:RKLB': ['Defense & aerospace'], 'NASDAQ:ASTS': ['Defense & aerospace'],
             'KRX:005930': ['AI & semiconductors'], 'KRX:000660': ['AI & semiconductors'],
             'KRX:012450': ['Defense & aerospace'], 'KRX:034020': ['Power & nuclear'],
             'NASDAQ:TSLA': ['Electrification'], 'NASDAQ:IREN': ['AI & semiconductors', 'Digital economy']}


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def fetch(url, payload=None, headers=None, raw=False):
    h = {'User-Agent': 'Mozilla/5.0 (compatible; MomentumTerminal/1.0)', 'Accept': 'application/json, application/xml, */*'}
    h.update(headers or {})
    if payload is not None:
        h['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, json.dumps(payload).encode() if payload is not None else None, h)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=22) as response:
                body = response.read()
            return body if raw else json.loads(body)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt * 2)


def percentile(values, value):
    """Midrank percentile, ties share a score; one observation is neutral."""
    if not number(value) or not values:
        return None
    if len(values) == 1:
        return 50.0
    low, high = bisect.bisect_left(values, value), bisect.bisect_right(values, value)
    return 100 * (low + (high - low - 1) / 2) / (len(values) - 1)


def score_stocks(stocks):
    for s in stocks:
        p = s.get('price')
        s['trend'] = (100 * sum(p > s[k] for k in ('sma20', 'sma50', 'sma200')) / 3
                      if number(p) and all(number(s.get(k)) for k in ('sma20', 'sma50', 'sma200')) else None)
        s['nearHigh'] = p / s['high52'] if number(p) and number(s.get('high52')) and s['high52'] > 0 else None
    distributions = {k: sorted(s[k] for s in stocks if number(s.get(k))) for k in WEIGHTS if k != 'trend'}
    for s in stocks:
        s['components'] = {k: s.get('trend') if k == 'trend' else percentile(distributions[k], s.get(k)) for k in WEIGHTS}
        coverage = sum(WEIGHTS[k] for k, v in s['components'].items() if v is not None)
        s['coverage'] = coverage
        s['score'] = round(sum(WEIGHTS[k] * v for k, v in s['components'].items() if v is not None) / coverage, 1) if coverage >= 70 else None
        s['extension'] = round((s['price'] / s['sma20'] - 1) * 100, 2) if number(s.get('sma20')) and s['sma20'] > 0 else None
        s['setup'] = ('Extended' if number(s['extension']) and s['extension'] > 15 else
                      'Near breakout' if number(s.get('nearHigh')) and s['nearHigh'] >= .97 and (s.get('rvol') or 0) >= 1.3 else
                      'Trending' if (s.get('trend') or 0) >= 66 and (s.get('month') or 0) > 0 else 'Mixed')
    stocks.sort(key=lambda s: (-(s['score'] if s['score'] is not None else -1), s.get('id', '')))
    for i, s in enumerate(stocks):
        s['rank'] = i + 1 if s['score'] is not None else None
    return stocks


def scan_country(country):
    # Primary common shares only. Native-currency liquidity thresholds are intentionally separate.
    floor = {'US': 1_000_000, 'CA': 250_000, 'KR': 500_000_000}[country]
    payload = {'filter': [{'left': 'type', 'operation': 'equal', 'right': 'stock'},
                           {'left': 'is_primary', 'operation': 'equal', 'right': True},
                           {'left': 'typespecs', 'operation': 'has', 'right': ['common']}],
               'columns': COLUMNS, 'sort': {'sortBy': 'market_cap_basic', 'sortOrder': 'desc'}, 'range': [0, 5000]}
    response = fetch(f'https://scanner.tradingview.com/{COUNTRIES[country]}/scan', payload)
    # Page through the complete common-share universe, with a defensive 20,000-row ceiling.
    for offset in range(5000, min(response.get('totalCount', 0), 20000), 5000):
        time.sleep(.3)
        page = fetch(f'https://scanner.tradingview.com/{COUNTRIES[country]}/scan', {**payload, 'range': [offset, offset + 5000]})
        if not page.get('data'):
            raise RuntimeError('Incomplete scanner pagination')
        response['data'].extend(page['data'])
    records = []
    seen = set()
    for row in response.get('data', []):
        if row['s'] in seen:
            continue
        seen.add(row['s'])
        s = dict(zip(FIELDS, row['d']))
        s.update(id=row['s'], country=country)
        if not number(s.get('price')) or s['price'] <= 0 or not number(s.get('avgVolume')):
            continue
        s['turnover'] = s['price'] * s['avgVolume']
        if s['turnover'] < floor:
            continue
        s['asOf'] = now()
        s['source'] = 'TradingView scanner'
        s['news'] = []
        s['newsStatus'] = 'Not collected: daily enrichment covers the top 15 and configured focus symbols per market.'
        s['chart'] = []
        s['chartStatus'] = 'Historical chart not collected.'
        s['insider'] = {'status': 'Not connected', 'transactions': [], 'filings': []}
        records.append(s)
    if not records:
        raise RuntimeError('Scanner returned no eligible stocks; previous snapshot preserved.')
    return {'country': country, 'asOf': now(), 'status': 'ok', 'universe': response.get('totalCount'),
            'truncated': response.get('totalCount', 0) > 20000, 'turnoverFloor': floor, 'stocks': score_stocks(records)}


def news_for(s):
    region = {'US': ('en-US', 'US', 'US:en'), 'CA': ('en-CA', 'CA', 'CA:en'), 'KR': ('ko', 'KR', 'KR:ko')}[s['country']]
    company = re.sub(r'\b(Corporation|Corp\.?|Inc\.?|Ltd\.?|Limited|Holdings?|Co\.?)\b', '', s['name'], flags=re.I).strip(' .,')
    company = re.sub(r'\s+(Class\s+[A-Z]|Common Stock|Common Shares|Ordinary Shares|Registered Shs).*$', '', company, flags=re.I).strip(' .,')
    company = re.sub(r'\s+', ' ', company)
    query = f'"{company or s["name"]}" stock when:7d'
    # Korea uses local coverage where possible; ticker also helps disambiguate English issuer names.
    if s['country'] == 'KR':
        company = re.sub(r'\(주\)|주식회사|보통주', '', s.get('localName', s['name'])).strip()
        query = f'"{company}" when:7d'
    url = 'https://news.google.com/rss/search?' + urllib.parse.urlencode({'q': query, 'hl': region[0], 'gl': region[1], 'ceid': region[2]})
    root = ET.fromstring(fetch(url, raw=True))
    items, seen = [], set()
    for item in root.findall('.//item'):
        title, link = item.findtext('title', ''), item.findtext('link', '')
        if not link.startswith('https://') or title in seen:
            continue
        seen.add(title)
        try:
            published = parsedate_to_datetime(item.findtext('pubDate')).isoformat()
        except Exception:
            published = None
        items.append({'title': title, 'url': link, 'source': item.findtext('source', 'Google News'), 'published': published})
    return items[:8]


def chart_for(s):
    symbol = s['symbol']
    if s['country'] == 'CA':
        if s['exchange'] not in ('TSX', 'TSXV'):
            return []
        symbol = symbol.replace('.', '-') + ('.V' if s['exchange'] == 'TSXV' else '.TO')
    if s['country'] == 'KR':
        # Yahoo chart metadata must confirm the currency; try both Korean venues.
        candidates = [symbol + '.KS', symbol + '.KQ']
    else:
        candidates = [symbol.replace('.', '-') if s['country'] == 'US' else symbol]
    for symbol in candidates:
        try:
            response = fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(symbol) + '?range=6mo&interval=1d')
            result = response['chart']['result'][0]
            if result['meta'].get('currency') != s['currency']:
                continue
            closes = result['indicators']['quote'][0]['close']
            return [{'date': datetime.fromtimestamp(t, timezone.utc).date().isoformat(), 'close': round(c, 4)}
                    for t, c in zip(result.get('timestamp', []), closes) if number(c)]
        except Exception:
            continue
    return []


def parse_form4(xml, url):
    root = ET.fromstring(xml)
    owner = root.findtext('.//reportingOwnerId/rptOwnerName', 'Unknown owner')
    rows = []
    for node in root.findall('.//nonDerivativeTransaction'):
        def text(path):
            return node.findtext(path)
        def num(path):
            try:
                return float(text(path))
            except (TypeError, ValueError):
                return None
        code = text('transactionCoding/transactionCode')
        shares = num('transactionAmounts/transactionShares/value')
        price = num('transactionAmounts/transactionPricePerShare/value')
        rows.append({'owner': owner, 'date': text('transactionDate/value'), 'code': code,
                     'type': {'P': 'Purchase', 'S': 'Sale', 'A': 'Award', 'M': 'Exercise', 'F': 'Tax withholding', 'G': 'Gift'}.get(code, 'Other'),
                     'shares': shares, 'price': price, 'value': shares * price if shares is not None and price is not None else None,
                     'url': url})
    return rows


def parse_nasdaq_insiders(data, symbol):
    table = (data.get('transactionTable') or {}).get('table') or {}
    rows = []
    def numeric(value):
        try:
            n = float(str(value).replace(',', '').replace('$', ''))
            return n if math.isfinite(n) else None
        except (ValueError, TypeError):
            return None
    url = f'https://www.nasdaq.com/market-activity/stocks/{urllib.parse.quote(symbol.lower())}/insider-activity'
    for record in table.get('rows') or []:
        label = record.get('transactionType', 'Unknown')
        # Nasdaq labels are preserved verbatim; they are not SEC transaction codes.
        side = 'sell' if label in ('Sell', 'Automatic Sell') else 'buy' if label in ('Buy', 'Purchase') else 'other'
        shares, price = numeric(record.get('sharesTraded')), numeric(record.get('lastPrice'))
        price = price if price is not None and price > 0 else None
        try:
            date = datetime.strptime(record['lastDate'], '%m/%d/%Y').date().isoformat()
        except (ValueError, KeyError):
            date = None
        rows.append({'owner': record.get('insider', 'Unknown'), 'relation': record.get('relation'),
                     'date': date, 'type': label, 'code': None, 'side': side, 'shares': shares, 'price': price,
                     'value': shares * price if shares is not None and price is not None else None,
                     'url': url})
    return {'status': 'Up to 15 recent reported transactions from Nasdaq. Automatic sales and non-open-market acquisitions keep their source labels; missing/zero prices are not valued.',
            'source': 'Nasdaq insider activity', 'asOf': now(), 'transactions': rows[:15], 'filings': [], 'url': url}


def nasdaq_for(s):
    url = f'https://api.nasdaq.com/api/company/{urllib.parse.quote(s["symbol"])}/insider-trades?limit=15&type=all&sortColumn=lastDate&sortOrder=DESC'
    response = fetch(url, headers={'Origin': 'https://www.nasdaq.com'})
    if not isinstance(response.get('data'), dict):
        raise RuntimeError('No Nasdaq insider dataset available')
    return parse_nasdaq_insiders(response['data'], s['symbol'])


def sec_for(s, cik, agent):
    headers = {'User-Agent': agent}
    time.sleep(.22)
    submissions = fetch(f'https://data.sec.gov/submissions/CIK{int(cik):010d}.json', headers=headers)
    recent = submissions.get('filings', {}).get('recent', {})
    filings, trades = [], []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).date().isoformat()
    form4_count = 0
    for i, form in enumerate(recent.get('form', [])):
        date = recent['filingDate'][i]
        if date < cutoff:
            continue
        accession = recent['accessionNumber'][i].replace('-', '')
        path = f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession}/'
        document = recent['primaryDocument'][i]
        if form in ('4', '4/A', '8-K', '10-Q', '10-K', '6-K') and len(filings) < 12:
            filings.append({'type': form, 'date': date, 'url': path + document})
        if form == '4' and form4_count < 5:
            form4_count += 1
            # Inline XSL presentation paths are not raw XML.
            raw_url = path + document.split('/')[-1]
            try:
                time.sleep(.22)
                trades.extend(parse_form4(fetch(raw_url, headers=headers, raw=True), path + document))
            except Exception:
                pass
    return {'status': 'Recent issuer filings checked; up to 5 Form 4 filings, 90-day window. Not a complete insider ledger.',
            'asOf': now(), 'transactions': trades, 'filings': filings, 'source': 'SEC EDGAR'}


def dart_codes(key):
    raw = fetch('https://opendart.fss.or.kr/api/corpCode.xml?' + urllib.parse.urlencode({'crtfc_key': key}), raw=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        root = ET.fromstring(z.read('CORPCODE.xml'))
    return {r.findtext('stock_code'): r.findtext('corp_code') for r in root.findall('list') if r.findtext('stock_code')}


def dart_for(s, code, key):
    query = urllib.parse.urlencode({'crtfc_key': key, 'corp_code': code})
    result = fetch('https://opendart.fss.or.kr/api/elestock.json?' + query)
    if result.get('status') not in ('000', '013'):
        raise RuntimeError('DART did not return ownership data')
    return {'status': 'Officer/major-holder ownership reports. Changes in holdings are not equivalent to market purchases.',
            'asOf': now(), 'transactions': [], 'source': 'DART', 'filings': [
                {'type': f'Ownership · {r.get("repror", "")} · change {r.get("sp_stock_lmp_irds_cnt", "—")} shares',
                 'date': r.get('rcept_dt'), 'url': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + r['rcept_no']}
                for r in result.get('list', [])[:10]]}


def tag_stock(s):
    base = ' '.join(str(s.get(k, '')) for k in ('name', 'sector', 'industry')).lower()
    tags, evidence = [], []
    for theme, keywords in THEMES.items():
        match = next((k for k in keywords if k in base), None)
        # Publisher names such as Yahoo Finance are not evidence of a financials narrative.
        headlines = [n for n in s.get('news', []) if any(
            re.search(r'(?<!\w)' + re.escape(k) + r'(?!\w)', n['title'].rsplit(' - ', 1)[0].lower())
            for k in keywords if k not in ('finance', 'consumer', 'industrial', 'internet', 'banks'))]
        curated = theme in OVERRIDES.get(s['id'], [])
        if match or headlines or curated:
            tags.append(theme)
            evidence.append({'theme': theme, 'basis': 'Headline keyword match' if headlines else 'Company/industry mapping',
                             'keyword': match, 'headlines': len(headlines)})
    s['themes'] = tags or ['Other']
    s['themeEvidence'] = evidence


def aggregate(stocks):
    results = []
    for name in list(THEMES) + ['Other']:
        members = [s for s in stocks if name in s['themes'] and s['score'] is not None]
        if not members:
            continue
        week_values = [s['week'] for s in members if number(s.get('week'))]
        results.append({'name': name, 'count': len(members), 'score': round(statistics.mean(s['score'] for s in members), 1),
                        'week': round(statistics.mean(week_values), 2) if week_values else None,
                        'breadth': round(100 * sum((s.get('trend') or 0) >= 66.6 for s in members) / len(members)),
                        'headlineCount': sum(len(s.get('news', [])) for s in members),
                        'leaders': [s['id'] for s in sorted(members, key=lambda s: s['score'], reverse=True)[:4]]})
    return sorted(results, key=lambda t: t['score'], reverse=True)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--enrich', type=int, default=15)
    parser.add_argument('--no-enrich', action='store_true')
    args = parser.parse_args()
    previous = json.loads((DATA / 'latest.json').read_text()) if (DATA / 'latest.json').exists() else {'markets': {}}
    snapshot = {'schemaVersion': 1, 'generatedAt': now(), 'mode': 'snapshot', 'markets': {}, 'sources': [], 'warnings': []}
    failed = []
    for country in COUNTRIES:
        try:
            snapshot['markets'][country] = scan_country(country)
            print(country, len(snapshot['markets'][country]['stocks']), 'eligible stocks', flush=True)
        except Exception as e:
            failed.append(country)
            old = previous.get('markets', {}).get(country)
            snapshot['markets'][country] = {**(old or {'stocks': [], 'asOf': None}), 'status': 'stale' if old else 'unavailable', 'error': f'Scanner unavailable ({type(e).__name__}); previous data retained when available.'}
            print(country, 'scan failed', type(e).__name__, flush=True)
    focus_path = ROOT / 'config.json'
    focus = json.loads(focus_path.read_text()).get('focusSymbols', []) if focus_path.exists() else []
    selected = []
    for country, market in snapshot['markets'].items():
        if country in failed:
            continue
        selected.extend([s for i, s in enumerate(market['stocks']) if i < args.enrich or s['id'] in focus])
    if not args.no_enrich:
        korean = [s for s in selected if s['country'] == 'KR']
        if korean:
            try:
                localized = fetch('https://scanner.tradingview.com/korea/scan', {
                    'options': {'lang': 'ko'}, 'symbols': {'tickers': [s['id'] for s in korean]},
                    'columns': ['description'], 'range': [0, len(korean)]})
                names = {r['s']: r['d'][0] for r in localized['data']}
                for s in korean:
                    s['localName'] = names.get(s['id'], s['name'])
            except Exception:
                snapshot['warnings'].append('Localized Korean issuer names unavailable.')
        def enrich(s):
            try:
                s['news'] = news_for(s)
                s['newsStatus'] = f'Google News search checked {now()}. Matches may be unrelated; verify source.'
            except Exception as e:
                s['newsStatus'] = f'News source unavailable ({type(e).__name__}).'
            s['chart'] = chart_for(s)
            s['chartStatus'] = 'Yahoo Finance daily closes; unadjusted, may differ from scanner.' if s['chart'] else 'Historical price source unavailable.'
            if s['country'] == 'US':
                try:
                    s['insider'] = nasdaq_for(s)
                except Exception:
                    s['insider']['status'] = 'Nasdaq insider source unavailable for this issuer during this scan.'
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(enrich, s) for s in selected]
            for future in as_completed(futures):
                future.result()
        print('News/chart enrichment completed for', len(selected), 'stocks', flush=True)
        sec_agent = os.getenv('SEC_USER_AGENT')
        ciks = {}
        if sec_agent:
            try:
                ciks = {v['ticker']: v['cik_str'] for v in fetch('https://www.sec.gov/files/company_tickers.json', headers={'User-Agent': sec_agent}).values()}
            except Exception:
                snapshot['warnings'].append('SEC ticker mapping unavailable.')
        key = os.getenv('DART_API_KEY')
        codes = {}
        if key:
            try:
                codes = dart_codes(key)
            except Exception:
                snapshot['warnings'].append('DART issuer mapping unavailable.')
        for s in selected:
            try:
                if s['country'] == 'US' and s['symbol'] in ciks:
                    sec = sec_for(s, ciks[s['symbol']], sec_agent)
                    if sec['transactions'] or not s['insider'].get('transactions'):
                        s['insider'] = sec
                    else:
                        s['insider']['filings'] = sec['filings']
                elif s['country'] == 'KR' and s['symbol'] in codes:
                    s['insider'] = dart_for(s, codes[s['symbol']], key)
            except Exception:
                s['insider']['status'] += ' Additional filings source unavailable during this scan.'
    snapshot['sources'] = [
        {'name': 'TradingView scanner', 'status': 'Partial failure' if failed else 'Connected', 'detail': 'Primary common stocks; delayed/as available snapshots. Unofficial, unsupported scanner interface.', 'url': 'https://www.tradingview.com/screener/'},
        {'name': 'Google News RSS', 'status': 'Best effort', 'detail': f'Top {args.enrich} per market + configured focus symbols. Headlines and links only; keyword matching is not causal analysis.', 'url': 'https://news.google.com/'},
        {'name': 'Yahoo Finance', 'status': 'Best effort', 'detail': 'Six months of daily closes for enriched symbols. Historical prices may use a different venue or timestamp.', 'url': 'https://finance.yahoo.com/'},
        {'name': 'Nasdaq insider activity', 'status': 'Best effort', 'detail': 'Up to 15 recent reported insider transactions for enriched US symbols; original source transaction labels retained. No API key required.', 'url': 'https://www.nasdaq.com/market-activity/insiders'},
        {'name': 'SEC EDGAR', 'status': 'Configured' if os.getenv('SEC_USER_AGENT') else 'Setup required', 'detail': 'Set SEC_USER_AGENT with your name and contact email in repository secrets. Bounded US Form 4 transactions and issuer filings.', 'url': 'https://www.sec.gov/edgar/search/'},
        {'name': 'Korea DART', 'status': 'Configured' if os.getenv('DART_API_KEY') else 'API key required', 'detail': 'Set DART_API_KEY in repository secrets for officer/major-holder ownership reports.', 'url': 'https://opendart.fss.or.kr/'},
        {'name': 'Canada SEDI / SEDAR+', 'status': 'External lookup', 'detail': 'Official insider and issuer disclosure links. No automated Canadian insider feed is connected.', 'url': 'https://www.sedi.ca/'}]
    history_file = DATA / 'history.json'
    history = json.loads(history_file.read_text()) if history_file.exists() else []
    today = datetime.now(timezone.utc).date().isoformat()
    baseline = next((h for h in reversed(history) if h['date'] < today), None)
    baseline_stocks = (baseline or {}).get('stocks', {})
    day_record = {'date': today, 'stocks': {}, 'themes': {}}
    for country, market in snapshot['markets'].items():
        for s in market['stocks']:
            tag_stock(s)
            old = baseline_stocks.get(s['id'])
            s['scoreDelta'] = round(s['score'] - old['score'], 1) if old and number(old.get('score')) and number(s.get('score')) and country not in failed else None
            s['rankDelta'] = old['rank'] - s['rank'] if old and old.get('rank') and s.get('rank') and country not in failed else None
            s['isNew'] = baseline is not None and old is None and country not in failed
            if country not in failed:
                day_record['stocks'][s['id']] = {k: s.get(k) for k in ['score', 'rank', 'price', 'themes']}
        market['themes'] = aggregate(market['stocks'])
        for theme in market['themes']:
            old = ((baseline or {}).get('themes', {}).get(country, {}).get(theme['name']))
            theme['delta'] = round(theme['score'] - old['score'], 1) if old and country not in failed else None
        if country not in failed:
            day_record['themes'][country] = {t['name']: {'score': t['score'], 'breadth': t['breadth']} for t in market['themes']}
    # A partial run is published with per-country timestamps, but never fabricates a full-day baseline.
    if not failed:
        history = [h for h in history if h['date'] != today] + [day_record]
        write_json(history_file, history[-90:])
    elif not history_file.exists():
        write_json(history_file, [])
    # The browser needs only a short score trail. Do not download the full 90-day archive on every visit.
    write_json(DATA / 'recent.json', [{'date': h['date'], 'stocks': {
        symbol: {'score': record.get('score'), 'rank': record.get('rank')}
        for symbol, record in h['stocks'].items()}} for h in history[-7:]])
    write_json(DATA / 'latest.json', snapshot)
    print('Snapshot saved:', snapshot['generatedAt'], flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
