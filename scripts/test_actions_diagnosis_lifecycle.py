import base64
from copy import deepcopy
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import actions_diagnosis_lifecycle as lifecycle
import codex_actions_diagnosis as task
from test_actions_failure_diagnosis import run

REPO = 'owner/repo'


def failure(**changes):
    return run(**{'created_at': '2026-11-12T00:00:00Z', **changes})


def success(**changes):
    return failure(**{'id': 43, 'conclusion': 'success', 'created_at': '2026-11-13T00:00:00Z', **changes})


def finding(state='active', **changes):
    return {'run_id': 42, 'state': state, 'fault_key': 'missing-input', 'report_markdown': '已核对具体输入与日志。',
            'resolution': {'run_id': 43 if state == 'recovered' else 0, 'fix_commit': '',
                           'jobs': ['check'] if state == 'recovered' else [],
                           'explanation': '已核对修复及原失败条件的成功日志。' if state == 'recovered' else ''}, **changes}


def issue(number=7, managed=None):
    return {'number': number, 'state': 'open', 'paused': False, 'body': lifecycle.workflow_marker(failure()),
            'snapshot': 'snapshot', 'managed': managed}


def context(issues=None):
    return {'version': 2, 'repository': REPO,
            'failures': [{**failure(), 'diagnosis_issues': [] if issues is None else issues,
                          'related_attempts': [[42, 1]], 'latest_run': failure()}],
            'historical': [], 'paused': []}


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        env = patch.dict(os.environ, {'GITHUB_REPOSITORY': REPO, 'GITHUB_STEP_SUMMARY': self.temp.name + '/summary'})
        env.start()
        self.addCleanup(env.stop)

    def collect(self, runs, issues=None, latest=None):
        def api(endpoint, *args):
            if '/actions/runs?' in endpoint:
                return {'workflow_runs': runs}
            if '/actions/runs/' in endpoint:
                return runs[0]
            raise AssertionError(endpoint)
        with patch.object(lifecycle, 'gh', side_effect=api), patch.object(lifecycle, 'pages', return_value=[]), \
                patch.object(lifecycle, 'inventory', return_value=issues or {}), \
                patch.object(lifecycle, 'latest_run', return_value=latest or runs[0]):
            return lifecycle.collect(REPO)

    def test_five_failures_in_one_workflow_become_one_investigation(self):
        runs = [failure(id=n) for n in range(42, 47)]
        data = self.collect(runs)
        self.assertEqual(len(data['failures']), 1)
        self.assertEqual(data['failures'][0]['id'], 46)
        self.assertEqual(len(data['failures'][0]['related_attempts']), 5)

    def test_historical_failure_after_success_is_summary_only_without_a_new_issue(self):
        data = self.collect([failure()], latest=success())
        self.assertEqual(data['failures'], [])
        self.assertEqual(len(data['historical']), 1)
        lifecycle.publish(data, {'coverage': '仅历史失败', 'findings': []})

    def test_open_issue_requires_recovery_investigation_even_when_workflow_is_green(self):
        key = lifecycle.workflow_marker(failure()).split(':')[1].split()[0]
        data = self.collect([failure()], {key: [issue()]}, latest=success())
        self.assertEqual(len(data['failures']), 1)
        self.assertEqual(data['historical'], [])

    def test_paused_incident_is_not_investigated_or_closed(self):
        key = lifecycle.workflow_marker(failure()).split(':')[1].split()[0]
        data = self.collect([failure()], {key: [{**issue(), 'paused': True}]}, latest=success())
        self.assertEqual(data['failures'], [])
        self.assertEqual(data['paused'][0]['issues'], [7])

    def test_stable_attempt_does_not_reinvoke_model_and_new_attempt_does(self):
        key = lifecycle.workflow_marker(failure()).split(':')[1].split()[0]
        item = issue(managed={'value': {'attempts': [[42, 1]], 'checked_run': [42, 1]}})
        self.assertEqual(self.collect([failure()], {key: [item]})['failures'], [])
        self.assertEqual(len(self.collect([failure(run_attempt=2)], {key: [item]})['failures']), 1)

    def test_recovery_requires_structured_proof(self):
        data = context()
        task.validate({'coverage': '核验', 'findings': [finding()]}, data)
        for key, value in [('run_id', 0), ('jobs', []), ('explanation', '')]:
            bad = finding('recovered')
            bad['resolution'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                task.validate({'coverage': '核验', 'findings': [bad]}, data)

    def test_verification_rejects_foreign_workflow_matrix_skip_and_later_failure(self):
        proof = finding('recovered')
        for changed in [success(head_branch='other'), success(path='.github/workflows/other.yml'),
                        success(head_repository={'full_name': 'other/repo'}), failure(id=43)]:
            with self.subTest(changed=changed), patch.object(lifecycle, 'gh', return_value=changed), self.assertRaises(ValueError):
                lifecycle.verify_recovery(REPO, failure(), proof)
        with patch.object(lifecycle, 'gh', return_value=success()), patch.object(lifecycle, 'pages', side_effect=[
                [{'name': 'check', 'conclusion': 'failure'}], [{'name': 'other-matrix', 'conclusion': 'success'}, {'name': 'check', 'conclusion': 'skipped'}]]), self.assertRaises(ValueError):
            lifecycle.verify_recovery(REPO, failure(), proof)
        with patch.object(lifecycle, 'gh', return_value=success()), patch.object(lifecycle, 'pages', side_effect=[
                [{'name': 'check', 'conclusion': 'failure'}], [{'name': 'check', 'conclusion': 'success'}]]), \
                patch.object(lifecycle, 'latest_run', return_value=failure(id=44)), self.assertRaises(ValueError):
            lifecycle.verify_recovery(REPO, failure(), proof)

    def test_verified_fix_must_be_contained_in_the_successful_version(self):
        proof = finding('recovered')
        proof['resolution']['fix_commit'] = 'b' * 40
        for status in ['ahead', 'diverged']:
            with patch.object(lifecycle, 'gh', side_effect=[success(), {'status': status}, {'status': 'ahead'}]), \
                    patch.object(lifecycle, 'pages', side_effect=[[{'name': 'check', 'conclusion': 'failure'}], [{'name': 'check', 'conclusion': 'success'}]]), \
                    patch.object(lifecycle, 'latest_run', return_value=success()):
                if status == 'diverged':
                    with self.assertRaises(ValueError):
                        lifecycle.verify_recovery(REPO, failure(), proof)
                else:
                    self.assertEqual(lifecycle.verify_recovery(REPO, failure(), proof)['id'], 43)

    def test_same_cause_updates_only_its_summary_without_new_comments(self):
        original = context()['failures'][0]
        body = lifecycle.body_for(original, finding(), {(42, 1)}, [])
        managed = {'endpoint': 'repos/owner/repo/issues/comments/99', 'body': body,
                   'value': lifecycle.state(body)}
        data = context([issue(managed=managed)])
        changed = finding(report_markdown='新的证据说明，原因未变。')
        with patch.object(lifecycle, 'gh', return_value=failure()) as api, \
                patch.object(lifecycle, 'check_snapshot', return_value={}):
            lifecycle.publish(data, {'coverage': '核对', 'findings': [changed]})
        mutations = [c for c in api.call_args_list if len(c.args) > 1]
        self.assertEqual(len(mutations), 1)
        self.assertEqual(mutations[0].args[:2], (managed['endpoint'], 'PATCH'))
        with patch.object(lifecycle, 'gh', return_value=failure()) as api, patch.object(lifecycle, 'check_snapshot', return_value={}):
            lifecycle.publish(data, {'coverage': '核对', 'findings': [finding()]})
        self.assertFalse(any(len(c.args) > 1 for c in api.call_args_list))

    def test_changed_cause_notifies_once_and_duplicate_closure_preserves_history(self):
        data = context([issue(9), issue(7)])
        with patch.object(lifecycle, 'gh', return_value=failure()) as api, patch.object(lifecycle, 'check_snapshot', return_value={}):
            lifecycle.publish(data, {'coverage': '核对', 'findings': [finding(fault_key='new-cause')]})
        calls = [c.args for c in api.call_args_list if len(c.args) > 1]
        self.assertEqual(calls[0][:2], ('repos/owner/repo/issues/7/comments', 'POST'))
        self.assertIn('历史诊断 #9', calls[0][2]['body'])
        self.assertEqual(calls[-1], ('repos/owner/repo/issues/9', 'PATCH', {'state': 'closed', 'state_reason': 'not_planned'}))
        self.assertFalse(any(c[1] == 'DELETE' for c in calls))

    def test_unverified_recovery_and_concurrent_edits_never_close_issues(self):
        for error in ['verification', 'concurrent']:
            with patch.object(lifecycle, 'gh', return_value=failure()) as api, \
                    patch.object(lifecycle, 'check_snapshot', side_effect=ValueError('edited') if error == 'concurrent' else None), \
                    patch.object(lifecycle, 'verify_recovery', side_effect=ValueError('unverified')), \
                    self.assertRaises(ValueError):
                lifecycle.publish(context([issue()]), {'coverage': '核对', 'findings': [finding('recovered')]})
            self.assertFalse(any(len(c.args) > 1 for c in api.call_args_list))

    def test_verified_recovery_closes_only_the_incident_after_delivering_evidence(self):
        with patch.object(lifecycle, 'gh', return_value=failure()) as api, patch.object(lifecycle, 'check_snapshot', return_value={}), \
                patch.object(lifecycle, 'verify_recovery', return_value=success()):
            lifecycle.publish(context([issue()]), {'coverage': '核对', 'findings': [finding('recovered')]})
        self.assertEqual(api.call_args.args, ('repos/owner/repo/issues/7', 'PATCH', {'state': 'closed', 'state_reason': 'completed'}))
        self.assertIn('恢复验证', api.call_args_list[-2].args[2]['body'])

    def test_duplicate_workflow_representatives_are_rejected_before_any_publication(self):
        data = context()
        data['failures'].append({**data['failures'][0], 'id': 44})
        with self.assertRaisesRegex(ValueError, '先聚合'):
            task.validate({'coverage': '核验', 'findings': [finding(), finding(run_id=44)]}, data)

    def test_snapshot_includes_owner_replies_and_never_overwrites_a_concurrent_edit(self):
        original = {'number': 7, 'state': 'open', 'body': '原文', 'updated_at': 'before', 'user': {'login': lifecycle.BOT}}
        frozen = {'number': 7, 'snapshot': lifecycle.issue_snapshot(original, [])}
        with patch.object(lifecycle, 'gh', return_value=original), patch.object(lifecycle, 'pages', return_value=[]):
            lifecycle.check_snapshot(REPO, frozen)
        reply = {'id': 9, 'body': '本人补充', 'updated_at': 'after'}
        with patch.object(lifecycle, 'gh', return_value=original), patch.object(lifecycle, 'pages', return_value=[reply]), self.assertRaisesRegex(ValueError, '变化'):
            lifecycle.check_snapshot(REPO, frozen)

    def test_empty_scan_still_saves_an_artifact_and_runs_summary_delivery_without_model(self):
        from pathlib import Path
        data = {**context(), 'failures': [], 'scope': '空扫描，已暂停的故障不处理'}
        with patch.object(task, 'OUT', Path(self.temp.name)), patch.dict(os.environ, {'GITHUB_OUTPUT': self.temp.name + '/outputs'}), patch.object(lifecycle, 'collect', return_value=data):
            task.prepare()
        result = json.loads(Path(self.temp.name, 'result.json').read_text())
        self.assertEqual(result['findings'], [])
        self.assertIn('ready=false', Path(self.temp.name, 'outputs').read_text())
        task.validate(result, data)
        lifecycle.publish(data, result)

    def test_artifact_replay_is_idempotent_after_publication_and_still_rejects_owner_edits(self):
        original = {'number': 7, 'state': 'open', 'body': lifecycle.workflow_marker(failure()), 'updated_at': 'before', 'user': {'login': lifecycle.BOT}}
        frozen = {**issue(), 'comments': {}, 'snapshot': lifecycle.issue_snapshot(original, [])}
        data = context([frozen])
        current, comments, mutations = deepcopy(original), [], []
        def api(endpoint, method='GET', payload=None):
            if method == 'GET':
                return failure() if '/actions/runs/' in endpoint else current
            mutations.append((endpoint, method, payload))
            if method == 'POST':
                comments.append({'id': 99, 'user': {'login': lifecycle.BOT}, 'body': payload['body'], 'updated_at': 'after'})
            else:
                current.update(payload)
            current['updated_at'] = 'after'
            return {'number': 7}
        with patch.object(lifecycle, 'gh', side_effect=api), patch.object(lifecycle, 'pages', side_effect=lambda *args: comments), patch.object(lifecycle, 'verify_recovery'):
            result = {'coverage': '核验', 'findings': [finding('recovered')]}
            lifecycle.publish(data, result)
            self.assertEqual(len(mutations), 2)
            lifecycle.publish(data, result)
            self.assertEqual(len(mutations), 2)
            comments.append({'id': 100, 'user': {'login': 'owner'}, 'body': '本人刚补充的条件', 'updated_at': 'later'})
            with self.assertRaisesRegex(ValueError, '变化'):
                lifecycle.publish(data, result)
            self.assertEqual(len(mutations), 2)

    def test_partial_initial_issue_creation_reuses_exact_delivery_instead_of_creating_again(self):
        data = context()
        body = lifecycle.body_for(data['failures'][0], finding(), {(42, 1)}, [])
        existing = issue(managed={'endpoint': 'repos/owner/repo/issues/7', 'body': body, 'value': lifecycle.state(body)})
        key = lifecycle.workflow_marker(failure()).split(':')[1].split()[0]
        with patch.object(lifecycle, 'gh', return_value=failure()) as api, patch.object(lifecycle, 'inventory', return_value={key: [existing]}), patch.object(lifecycle, 'check_snapshot', return_value={'matched': {'body': body}, 'state': 'open'}):
            lifecycle.publish(data, {'coverage': '核对', 'findings': [finding()]})
        self.assertFalse(any(len(c.args) > 1 for c in api.call_args_list))

    def test_same_bot_author_does_not_authorize_mutating_another_workflow_or_article(self):
        current = {'state': 'open', 'body': '这是另一篇机器人文章', 'user': {'login': lifecycle.BOT}}
        frozen = {'number': 7, 'snapshot': lifecycle.issue_snapshot(current, [])}
        with patch.object(lifecycle, 'gh', return_value=current), patch.object(lifecycle, 'pages', return_value=[]), self.assertRaisesRegex(ValueError, '来源'):
            lifecycle.check_snapshot(REPO, frozen, expected_marker=lifecycle.workflow_marker(failure()))

    def test_model_cannot_rewrite_the_issue_inventory_to_expand_publish_scope(self):
        from pathlib import Path
        folder = Path(self.temp.name)
        data = context([issue()])
        (folder / 'context.json').write_text(json.dumps(data))
        def tamper(*args, **kwargs):
            (folder / 'context.json').write_text(json.dumps({**data, 'repository': 'other/repo'}))
            (folder / 'result.json').write_text(json.dumps({'coverage': '核对', 'findings': [finding()]}))
        with patch.object(task, 'OUT', folder), patch.object(task, 'run_codex', side_effect=tamper), self.assertRaisesRegex(ValueError, '输入'):
            task.execute()


if __name__ == '__main__':
    unittest.main()
