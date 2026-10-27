"""Synthetic-only authority-boundary model for H-AIS-20261026-01.

No network, GitHub, tokens, filesystem modifications, or real exploit paths.
This verifies model invariants, NOT a real product's protection.
Run: python -m unittest -v ai_security_h01_mock.py
"""
import unittest
from dataclasses import dataclass

OWNER_TOKEN = 'FAKE-OWNER-TOKEN'
SCOPED_TOKEN = 'FAKE-PR-ONLY'
HANDLE = 'opaque:agent-A'

@dataclass
class Identity:
    permissions: frozenset

class MockRepo:
    def __init__(self):
        self.identities = {
            OWNER_TOKEN: Identity(frozenset({'pr:create', 'release:modify'})),
            SCOPED_TOKEN: Identity(frozenset({'pr:create'})),
        }
        self.effects = []

    def perform(self, credential, action):
        permitted = action in self.identities.get(credential, Identity(frozenset())).permissions
        if permitted:
            self.effects.append(action)
        return permitted

class MockControlPlane:
    def __init__(self, live_master, exposed_value):
        self.live_master = live_master
        self.exposed_value = exposed_value

    def inventory(self, presented_master):
        if presented_master != self.live_master:
            return None
        return {'agent': 'agent-A', 'credential': self.exposed_value}

class MockBroker:
    def __init__(self, enforce_task_scope):
        self.enforce_task_scope = enforce_task_scope

    def redeem(self, handle, requested_action):
        if handle != HANDLE:
            return None
        if self.enforce_task_scope and requested_action != 'pr:create':
            return None
        return SCOPED_TOKEN if self.enforce_task_scope else OWNER_TOKEN

class ReleaseGate:
    def permit(self, source_repo, expected_repo, digest_ok, approval_independent):
        return source_repo == expected_repo and digest_ok and approval_independent

class BoundaryTests(unittest.TestCase):
    def test_01_baseline_owner_credential_is_readable_and_authorizes_release_change(self):
        cp, repo = MockControlPlane('MASTER', OWNER_TOKEN), MockRepo()
        exposed = cp.inventory('MASTER')['credential']
        self.assertEqual(exposed, OWNER_TOKEN)
        self.assertTrue(repo.perform(exposed, 'release:modify'))

    def test_02_opaque_handle_alone_does_not_fix_permissive_broker(self):
        cp, broker, repo = MockControlPlane('MASTER', HANDLE), MockBroker(False), MockRepo()
        exposed = cp.inventory('MASTER')['credential']
        self.assertEqual(exposed, HANDLE)
        self.assertTrue(repo.perform(broker.redeem(exposed, 'release:modify'), 'release:modify'))

    def test_03_scoped_broker_denies_release_and_keeps_legitimate_pr(self):
        cp, broker, repo = MockControlPlane('MASTER', HANDLE), MockBroker(True), MockRepo()
        exposed = cp.inventory('MASTER')['credential']
        self.assertFalse(repo.perform(broker.redeem(exposed, 'release:modify'), 'release:modify'))
        self.assertTrue(repo.perform(broker.redeem(exposed, 'pr:create'), 'pr:create'))
        self.assertEqual(repo.effects, ['pr:create'])

    def test_04_scoped_token_visible_but_cannot_cross_permission_boundary(self):
        cp, repo = MockControlPlane('MASTER', SCOPED_TOKEN), MockRepo()
        exposed = cp.inventory('MASTER')['credential']
        self.assertEqual(exposed, SCOPED_TOKEN)
        self.assertTrue(repo.perform(exposed, 'pr:create'))
        self.assertFalse(repo.perform(exposed, 'release:modify'))

    def test_05_revoked_master_blocks_old_secret_and_allows_new(self):
        cp = MockControlPlane('NEW-MASTER', OWNER_TOKEN)
        self.assertIsNone(cp.inventory('OLD-MASTER'))
        self.assertIsNotNone(cp.inventory('NEW-MASTER'))

    def test_06_independent_release_gate_blocks_source_mismatch(self):
        gate = ReleaseGate()
        self.assertFalse(gate.permit('lookalike/project', 'trusted/project', True, True))
        self.assertFalse(gate.permit('trusted/project', 'trusted/project', True, False))
        self.assertTrue(gate.permit('trusted/project', 'trusted/project', True, True))

if __name__ == '__main__':
    unittest.main(verbosity=2)
