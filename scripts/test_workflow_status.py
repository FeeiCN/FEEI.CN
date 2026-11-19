import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]

class WorkflowStatusTests(unittest.TestCase):
    def test_jobs_using_workflow_status_finalize_and_save_evidence(self):
        for file in (ROOT / '.github/workflows').glob('*.yml'):
            workflow = yaml.safe_load(file.read_text())
            for name, job in workflow['jobs'].items():
                steps = job.get('steps', [])
                status_steps = [
                    (index, step) for index, step in enumerate(steps)
                    if step.get('uses', '').endswith('/workflow-status')
                ]
                if not status_steps:
                    continue
                with self.subTest(workflow=file.name, job=name):
                    checkout = next(
                        index for index, step in enumerate(steps)
                        if step.get('uses', '').startswith('actions/checkout@')
                    )
                    self.assertLess(checkout, status_steps[0][0])
                    final = next(
                        step for _, step in status_steps
                        if step.get('with', {}).get('phase') == 'finished'
                        and 'always()' in str(step.get('if'))
                    )
                    self.assertTrue(final['continue-on-error'])
                    evidence = steps[-1]
                    self.assertEqual(evidence.get('uses'), 'actions/upload-artifact@v4')
                    self.assertEqual(evidence['if'], 'always()')
                    self.assertTrue(evidence['continue-on-error'])
                    self.assertIn('runner.temp', evidence['with']['path'])
                    for index, step in enumerate(steps):
                        if step.get('name', '').startswith('更新阶段：'):
                            self.assertEqual(step.get('if'), steps[index + 1].get('if'))

    def test_issue_execution_label_is_set_after_source_verification(self):
        workflow = yaml.safe_load((ROOT / '.github/workflows/codex-issue-driver.yml').read_text())
        jobs = workflow['jobs']
        marker = jobs['mark-executing']
        turn = jobs['turn']
        names = [step.get('name') for step in marker['steps']]

        self.assertEqual(marker['permissions']['issues'], 'write')
        self.assertEqual(turn['permissions']['issues'], 'read')
        self.assertEqual(jobs['publish']['permissions']['issues'], 'write')
        self.assertEqual(turn['needs'], 'mark-executing')
        self.assertEqual(marker['if'], turn['if'])
        self.assertLess(names.index('恢复并核验当前会话'), names.index('完成任务状态'))
        self.assertLess(names.index('完成任务状态'), names.index('更新会话执行状态'))

        label_step = marker['steps'][names.index('更新会话执行状态')]
        self.assertEqual(
            label_step['if'],
            "steps.prepare.outputs.ready == 'true' && inputs.dry_run != 'true'",
        )
        self.assertEqual(label_step['with']['issue-number'], '${{ steps.prepare.outputs.issue }}')
        self.assertEqual(label_step['with']['label'], 'executing')
        self.assertEqual(label_step['with']['task'], 'issue-label')
        self.assertFalse(workflow['concurrency']['cancel-in-progress'])

        source = (ROOT / '.github/workflows/codex-issue-driver.yml').read_text()
        self.assertNotIn('--remove-label', source)
        self.assertNotIn('--add-label', source)
        self.assertNotIn('locked = labels', source)

if __name__ == '__main__':
    unittest.main()
