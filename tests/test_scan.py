import importlib.util
from pathlib import Path
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('scan', Path(__file__).resolve().parents[1] / 'scripts/scan.py')
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)


class MomentumTests(unittest.TestCase):
    def stock(self, **overrides):
        return {'price': 100, 'sma20': 90, 'sma50': 80, 'sma200': 70, 'high52': 100,
                'week': 5, 'month': 15, 'quarter': 30, 'rvol': 2, **overrides}

    def test_percentiles_do_not_reward_identical_observations(self):
        self.assertEqual(scan.percentile([5, 5, 5], 5), 50)
        self.assertEqual(scan.percentile([1, 2, 2, 3], 2), 50)
        self.assertEqual(scan.percentile([1, 2, 3], 1), 0)
        self.assertEqual(scan.percentile([1, 2, 3], 3), 100)

    def test_missing_coverage_is_not_treated_as_zero_return(self):
        incomplete = self.stock(week=None, month=None, quarter=None)
        complete = self.stock()
        scan.score_stocks([complete, incomplete])
        self.assertIsNone(incomplete['score'])
        self.assertIsNone(incomplete['rank'])
        self.assertEqual(complete['rank'], 1)

    def test_country_cohorts_are_independent(self):
        us = [self.stock(week=1), self.stock(week=10)]
        kr = [self.stock(week=100), self.stock(week=200)]
        scan.score_stocks(us)
        scan.score_stocks(kr)
        self.assertEqual([s['score'] for s in us], [s['score'] for s in kr])

    def test_extended_has_priority_over_breakout(self):
        s = self.stock(sma20=75)
        scan.score_stocks([s])
        self.assertEqual(s['setup'], 'Extended')

    def test_zero_variance_and_missing_averages_are_safe(self):
        s = self.stock(sma20=None, sma50=None, sma200=None)
        scan.score_stocks([s])
        self.assertIsNone(s['trend'])
        self.assertEqual(s['coverage'], 90)
        self.assertEqual(s['score'], 50)

    def test_awards_and_sales_are_not_mislabeled_as_purchases(self):
        xml = '''<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Example Director</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable>'''
        for code in ['P', 'S', 'A']:
            xml += f'''<nonDerivativeTransaction><transactionDate><value>2026-01-01</value></transactionDate><transactionCoding><transactionCode>{code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>100</value></transactionShares><transactionPricePerShare><value>12.5</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>'''
        xml += '</nonDerivativeTable></ownershipDocument>'
        result = scan.parse_form4(xml, 'https://www.sec.gov/example')
        self.assertEqual([t['type'] for t in result], ['Purchase', 'Sale', 'Award'])
        self.assertEqual(result[0]['value'], 1250)

    def test_no_theme_evidence_does_not_invent_story(self):
        s = {'id': 'TEST:X', 'name': 'Unknown', 'sector': '', 'industry': '', 'news': []}
        scan.tag_stock(s)
        self.assertEqual(s['themes'], ['Unclassified'])
        self.assertEqual(s['narratives'], [])

    def test_news_publisher_is_not_company_theme_evidence(self):
        s = {'id': 'TEST:X', 'name': 'Example retailer', 'sector': 'Retail Trade', 'industry': 'Apparel',
             'news': [{'title': 'Example retailer reports sales - Yahoo Finance'}]}
        scan.tag_stock(s)
        self.assertNotIn('Financials', s['themes'])
        self.assertEqual(s['themes'], ['Apparel'])

    def test_headlines_cannot_reclassify_a_company(self):
        s = {'id': 'TEST:X', 'industry': 'Regional Banks', 'news': [{'title': 'Bank finances nuclear project - News'}]}
        scan.tag_stock(s)
        self.assertEqual(s['themes'], ['Regional Banks'])
        self.assertEqual(s['catalysts'][0]['name'], 'Power & nuclear')

    def test_scanner_explicitly_requests_usd_without_converting_quote_prices(self):
        values = {'symbol': '005930', 'name': 'Samsung Electronics', 'price': 70000,
                  'currency': 'KRW', 'avgVolume': 20000, 'marketCapUsd': 1_000_000_000}
        response = {'totalCount': 1, 'data': [{'s': 'KRX:005930', 'd': [values.get(k) for k in scan.FIELDS]}]}
        with patch.object(scan, 'fetch', return_value=response) as fetch:
            result = scan.scan_country('KR')
        payload = fetch.call_args.args[1]
        self.assertEqual(payload['price_conversion'], {'to_currency': 'usd'})
        self.assertEqual(payload['options']['lang'], 'en')
        stock = result['stocks'][0]
        self.assertEqual(stock['marketCapUsd'], 1_000_000_000)
        self.assertEqual(stock['marketCapCurrency'], 'USD')
        self.assertEqual(stock['price'], 70000)
        self.assertEqual(stock['currency'], 'KRW')

    def test_nasdaq_non_open_market_acquisitions_are_not_buys(self):
        rows = [{'insider': 'Director', 'transactionType': kind, 'sharesTraded': '1,000', 'lastPrice': price, 'lastDate': '9/04/2026'}
                for kind, price in [('Sell', '$12.50'), ('Automatic Sell', '$0.00'), ('Acquisition (Non Open Market)', '$0.00')]]
        result = scan.parse_nasdaq_insiders({'transactionTable': {'table': {'rows': rows}}}, 'TEST')
        tx = result['transactions']
        self.assertEqual(tx[0]['value'], 12500)
        self.assertEqual(tx[1]['type'], 'Automatic Sell')
        self.assertIsNone(tx[1]['value'])
        self.assertEqual(tx[2]['side'], 'other')
        self.assertIsNone(tx[2]['code'])
        self.assertEqual(tx[0]['date'], '2026-09-04')


if __name__ == '__main__':
    unittest.main()
