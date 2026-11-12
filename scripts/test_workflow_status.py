import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]

class WorkflowStatusTests(unittest.TestCase):
    def test_every_job_has_early_start_finalization_and_evidence(self):
        for file in (ROOT / '.github/workflows').glob('*.yml'):
            workflow = yaml.safe_load(file.read_text())
            for name, job in workflow['jobs'].items():
                if 'steps' not in job:
                    continue
                with self.subTest(workflow=file.name, job=name):
                    steps = job['steps']
                    start = next(i for i, s in enumerate(steps) if s.get('name') == '开始任务状态')
                    checkout = next(i for i, s in enumerate(steps) if s.get('uses', '').startswith('actions/checkout@'))
                    self.assertEqual(start, checkout + 1)
                    final = next(s for s in steps if s.get('name') == '完成任务状态')
                    self.assertIn('always()', final['if'])
                    self.assertTrue(final['continue-on-error'])
                    evidence = steps[-1]
                    self.assertEqual(evidence['name'], '保存任务状态')
                    self.assertEqual(evidence['if'], 'always()')
                    self.assertTrue(evidence['continue-on-error'])
                    self.assertIn('runner.temp', evidence['with']['path'])
                    for s in steps:
                        if s.get('name', '').startswith('更新阶段：'):
                            target = steps[steps.index(s) + 1]
                            self.assertEqual(s.get('if'), target.get('if'))

    def test_issue_status_precedes_installation_and_does_not_lock_execution(self):
        workflow = yaml.safe_load((ROOT / '.github/workflows/codex-issue-driver.yml').read_text())
        steps = workflow['jobs']['drive']['steps']
        names = [s.get('name') for s in steps]
        self.assertLess(names.index('核验议题来源与请求'), names.index('来源核验后显示执行状态'))
        self.assertLess(names.index('来源核验后显示执行状态'), names.index('准备自然语言解释器'))
        source = (ROOT / '.github/workflows/codex-issue-driver.yml').read_text()
        self.assertNotIn('--remove-label', source)
        self.assertNotIn('--add-label', source)
        self.assertNotIn('locked = labels', source)
        self.assertIn('concurrency:', source)

if __name__ == '__main__':
    unittest.main()
