import copy
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from signals import signal_masks, summarize, update_market, closed_session


class RecurringSignalsTests(unittest.TestCase):
    def test_missing_values_are_unknown_not_negative(self):
        self.assertEqual(signal_masks({'score': 80}), [1, 1])
        self.assertEqual(signal_masks({'score': None, 'rvol': 2, 'day': -1, 'nearHigh': .98}), [6, 4])
        self.assertEqual(signal_masks({'score': 79, 'rvol': 2, 'day': 1, 'nearHigh': .97}), [7, 6])

    def test_same_signal_must_recur_not_three_different_signals(self):
        self.assertFalse(summarize([[7, 1], [7, 2], [7, 4]])['recurring'])
        self.assertTrue(summarize([[7, 1], [7, 1], [7, 1]])['recurring'])

    def test_returning_signal_differs_from_sustained_strength(self):
        steady = summarize([[7, 1], [7, 1], [7, 1]])
        self.assertEqual(steady['signalStreak'], 3)
        self.assertFalse(steady['renewed'])
        returning = summarize([[7, 1], [7, 0], [7, 1], [7, 0], [7, 1]])
        self.assertTrue(returning['renewed'])
        self.assertTrue(returning['recurring'])
        self.assertEqual(returning['signalStreak'], 1)
        self.assertFalse(summarize([[7, 1], None, [7, 1]])['renewed'])
        self.assertFalse(summarize([[7, 1], [6, 0], [7, 1]])['renewed'])
        self.assertFalse(summarize([[7, 1], [7, 1], [7, 1], [7, 0]])['recurring'])

    def test_reruns_and_weekends_do_not_increment_or_rewrite_a_session(self):
        market = {'status': 'ok', 'stocks': [{'id': 'TEST:A', 'score': 90}]}
        records = update_market(market, [], '2026-09-11')
        before = copy.deepcopy(records)
        market['stocks'][0]['score'] = 1
        records = update_market(market, records, '2026-09-11')
        self.assertEqual(records, before)
        self.assertEqual(market['stocks'][0]['repeatCount'], 1)
        self.assertFalse(market['stocks'][0]['recurring'])

    def test_window_expires_old_hits_and_keeps_countries_independent(self):
        records = [{'date': f'2026-08-{n:02}', 'stocks': {'TEST:A': [7, 1 if n <= 3 else 0]}} for n in range(1, 14)]
        m = {'status': 'ok', 'stocks': [{'id': 'TEST:A', 'score': 90}]}
        update_market(m, records, '2026-09-11')
        self.assertEqual(len(m['signalSessions']), 10)
        self.assertEqual(m['stocks'][0]['repeatCount'], 1)
        ca = {'status': 'ok', 'stocks': [{'id': 'TEST:A', 'score': 90}]}
        update_market(ca, [], '2026-09-11')
        self.assertEqual(ca['stocks'][0]['observedSessions'], 1)

    def test_failure_retains_evidence_but_suppresses_current_flags(self):
        records = [{'date': f'2026-09-{n:02}', 'stocks': {'TEST:A': [7, 1]}} for n in [8, 9, 10]]
        m = {'status': 'stale', 'stocks': [{'id': 'TEST:A', 'score': 90}]}
        self.assertEqual(update_market(m, records, '2026-09-11'), records)
        self.assertFalse(m['signalCurrent'])
        self.assertFalse(m['stocks'][0]['recurring'])
        self.assertEqual(m['stocks'][0]['repeatCount'], 3)

    def test_older_benchmark_cannot_insert_backdated_observations(self):
        records = [{'date': '2026-09-11', 'stocks': {'TEST:A': [7, 1]}}]
        market = {'status': 'ok', 'stocks': [{'id': 'TEST:A', 'score': 90}]}
        self.assertEqual(update_market(market, records, '2026-09-10'), records)
        self.assertFalse(market['signalCurrent'])

    def test_session_date_uses_exchange_time_and_rejects_intraday(self):
        stamp = lambda text: int(datetime.fromisoformat(text).timestamp())
        meta = {'currency': 'USD', 'exchangeTimezoneName': 'America/New_York',
                'regularMarketTime': stamp('2026-09-11T20:00:00+00:00'),
                'currentTradingPeriod': {'regular': {'start': stamp('2026-09-11T13:30:00+00:00'), 'end': stamp('2026-09-11T20:00:00+00:00')}}}
        response = {'chart': {'result': [{'meta': meta, 'timestamp': [stamp('2026-09-11T13:30:00+00:00')]}]}}
        self.assertEqual(closed_session(response, 'US', '2026-09-12T16:00:00+00:00'), '2026-09-11')
        with self.assertRaises(ValueError): closed_session(response, 'US', '2026-09-11T20:05:00+00:00')
        with self.assertRaises(ValueError): closed_session(response, 'US', '2026-09-22T22:00:00+00:00')
        with self.assertRaises(ValueError): closed_session(response, 'KR', '2026-09-12T16:00:00+00:00')


if __name__ == '__main__': unittest.main()
