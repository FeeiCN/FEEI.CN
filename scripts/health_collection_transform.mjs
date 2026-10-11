function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export function buildMedicationCollection(records, options = {}) {
  const normalizeDateTime = options.normalizeDateTime ?? ((value) => value);
  const validRecords = records.filter((record) => (
    record?.start ?? record?.scheduledDate ?? record?.end
  ));

  return {
    summary: {
      count: records.length,
      byStatus: countBy(records, (record) => record.status),
      byMedication: countBy(records, medicationName),
    },
    timeline: validRecords.map((record) => {
      const start = record.start ?? record.scheduledDate ?? record.end;
      return dropUndefined({
        type: 'medication',
        name: medicationName(record),
        start: normalizeDateTime(start),
        end: normalizeDateTime(record.end ?? start),
        scheduledDate: normalizeDateTime(record.scheduledDate),
        status: record.status,
        dosage: finiteNumber(record.dosage),
        scheduledDosage: finiteNumber(record.scheduledDosage),
        units: record.units,
        isArchived: typeof record.isArchived === 'boolean' ? record.isArchived : undefined,
      });
    }).sort((left, right) => String(left.start).localeCompare(String(right.start))),
  };
}

function medicationName(record) {
  return record?.displayText ?? record?.nickname ?? record?.name;
}

function finiteNumber(value) {
  const number = Number(value);
  return value !== undefined && value !== null && Number.isFinite(number) ? number : undefined;
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = selector(record);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
