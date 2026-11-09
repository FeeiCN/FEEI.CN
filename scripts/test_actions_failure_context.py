import hashlib
import unittest
from unittest.mock import Mock

from actions_failure_context import SLEEP_PARSER, SLEEP_WORKFLOW, associated_inputs, parser_probe

BODY = '睡眠评分\n良好\n时长：40/50\n83\n就寝：25/30\n中断：18/20\n睡眠\n生命体征\n11\n7小时\n正常'
SOURCE = '''
import re
def parse_issue(issue, repo):
    text = issue['body']
    totals = re.findall(r'^\\s*(\\d{1,3})\\s*$', text, re.M)
    if len(totals) != 1:
        raise ValueError('ambiguous')
'''


class ContextTests(unittest.TestCase):
    def setup_input(self, body=BODY):
        run = {'path': SLEEP_WORKFLOW, 'updated_at': '2026-02-21T01:00:00Z'}
        issue = {'title': '睡眠评分', 'user': {'login': 'owner'}, 'body': body,
                 'created_at': '2026-02-20T00:00:00Z'}
        return run, issue

    def test_fixed_probe_reproduces_mechanism_without_executing_source(self):
        check = parser_probe(BODY, SOURCE + "\nraise RuntimeError('must never execute')")
        self.assertEqual(check['state'], 'mechanism_reproduced')
        self.assertEqual(check['candidate_count'], 2)
        for text in (BODY.replace('83', '84'), BODY.replace('40/50', '40/60'), BODY.replace('83\n', '')):
            self.assertEqual(parser_probe(text, SOURCE)['state'], 'not_verified')
        self.assertEqual(parser_probe(BODY, SOURCE.replace(', text,', ', score_panel,'))['state'], 'not_verified')

    def test_associated_input_hash_verified_and_raw_body_not_retained(self):
        run, issue = self.setup_input()
        reference = {'issue_number': 12, 'body_sha256': hashlib.sha256(BODY.encode()).hexdigest()}
        inputs, checks = associated_inputs('owner/repo', run, [reference], {SLEEP_PARSER: SOURCE}, Mock(return_value=issue))
        self.assertEqual(inputs[0]['input_version'], 'matched')
        self.assertEqual(checks[0]['state'], 'mechanism_reproduced')
        self.assertNotIn(BODY, str(inputs) + str(checks))

    def test_changed_input_is_not_replayed_as_historical_failure(self):
        run, issue = self.setup_input()
        inputs, checks = associated_inputs('owner/repo', run, [{'issue_number': 12, 'body_sha256': '0' * 64}],
                                          {SLEEP_PARSER: SOURCE}, Mock(return_value=issue))
        self.assertEqual(checks[0]['state'], 'input_changed')
        self.assertEqual(inputs[0]['input_version'], 'changed')

    def test_legacy_input_is_explicitly_not_historically_verified(self):
        run, issue = self.setup_input()
        inputs, checks = associated_inputs('owner/repo', run, [{'issue_number': 12}],
                                          {SLEEP_PARSER: SOURCE}, Mock(return_value=issue))
        self.assertEqual(checks[0]['input_version'], 'historical_version_unknown')

    def test_unrelated_workflow_outsider_and_future_issue_rejected(self):
        run, issue = self.setup_input()
        api = Mock(return_value=issue)
        unrelated = {**run, 'path': '.github/workflows/deploy.yml'}
        self.assertEqual(associated_inputs('owner/repo', unrelated, [{'issue_number': 12}], {}, api), ([], []))
        api.assert_not_called()
        for change in ({'user': {'login': 'outsider'}}, {'created_at': '2027-01-01T00:00:00Z'},
                       {'title': 'other'}, {'pull_request': {'url': 'example'}}):
            self.assertEqual(associated_inputs('owner/repo', run, [{'issue_number': 12}], {}, Mock(return_value={**issue, **change})), ([], []))
