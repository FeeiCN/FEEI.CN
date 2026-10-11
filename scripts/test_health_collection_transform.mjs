import assert from 'node:assert/strict';
import test from 'node:test';
import {buildMedicationCollection} from './health_collection_transform.mjs';

test('buildMedicationCollection preserves medication details and summaries', () => {
  const records = [
    {
      displayText: '碳酸氢钠片',
      start: '2026-10-10 23:09:41 +0800',
      end: '2026-10-10 23:09:41 +0800',
      scheduledDate: '2026-10-10 09:30:00 +0800',
      status: '已服用',
      dosage: 1,
      scheduledDosage: 1,
      units: 'count',
      isArchived: false,
    },
    {
      displayText: '苯溴马隆片',
      start: '2026-10-10 13:00:00 +0800',
      scheduledDate: '2026-10-10 13:00:00 +0800',
      status: '未操作',
      scheduledDosage: 0.5,
      units: 'count',
    },
  ];

  const result = buildMedicationCollection(records);

  assert.deepEqual(result.summary, {
    count: 2,
    byStatus: {'已服用': 1, '未操作': 1},
    byMedication: {'碳酸氢钠片': 1, '苯溴马隆片': 1},
  });
  assert.deepEqual(result.timeline[1], {
    type: 'medication',
    name: '碳酸氢钠片',
    start: '2026-10-10 23:09:41 +0800',
    end: '2026-10-10 23:09:41 +0800',
    scheduledDate: '2026-10-10 09:30:00 +0800',
    status: '已服用',
    dosage: 1,
    scheduledDosage: 1,
    units: 'count',
    isArchived: false,
  });
  assert.equal(result.timeline[0].name, '苯溴马隆片');
  assert.equal(result.timeline[0].scheduledDosage, 0.5);
  assert.equal('dosage' in result.timeline[0], false);
  assert.deepEqual(result.timeline.map((record) => record.start), [
    '2026-10-10 13:00:00 +0800',
    '2026-10-10 23:09:41 +0800',
  ]);
});

test('buildMedicationCollection uses the actual time for unscheduled medication records', () => {
  const result = buildMedicationCollection([{
    displayText: '维生素D3',
    start: '2026-09-23 22:20:47 +0800',
    end: '2026-09-23 22:20:47 +0800',
    status: '已服用',
    dosage: 3,
    units: 'count',
    isArchived: false,
  }]);

  assert.equal(result.timeline[0].scheduledDate, '2026-09-23 22:20:47 +0800');
});
