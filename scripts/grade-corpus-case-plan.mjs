import { createHash } from 'node:crypto';

const sha256Json = (value) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

const caseId = (key, value) => `${key}-${value < 0 ? 'minus' : 'plus'}-${Math.abs(value)}`
  .replaceAll('.', '_');

export const defaultGradeGroupLabel = (suite) => suite.groupLabel ?? suite.section
  .split('-')
  .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
  .join(' ');

export const buildGradeLightTableCases = (suite) => {
  const defaultGroupLabel = defaultGradeGroupLabel(suite);
  const cases = [{
    id: 'neutral', key: null, label: 'Neutral', value: 0,
    baselineId: 'neutral', isBaseline: true, settings: []
  }];
  for (const control of suite.controls ?? []) {
    const prerequisites = [
      ...(suite.lightTablePrerequisites ?? []),
      ...(control.lightTablePrerequisites ?? [])
    ].map((entry) => ({
      ...entry,
      groupLabel: entry.groupLabel ?? control.groupLabel ?? defaultGroupLabel,
      subgroupLabel: entry.subgroupLabel ?? null,
      defaultValue: entry.defaultValue ?? 0
    }));
    const baselineId = prerequisites.length ? `${control.key}-baseline` : 'neutral';
    if (prerequisites.length) cases.push({
      id: baselineId, key: control.key, label: `${control.label} baseline`, value: null,
      baselineId, isBaseline: true, settings: prerequisites
    });
    for (const value of control.values) cases.push({
      id: caseId(control.key, value), key: control.key, label: control.label, value,
      baselineId, isBaseline: false,
      settings: [...prerequisites, {
        groupLabel: control.groupLabel ?? defaultGroupLabel,
        subgroupLabel: control.subgroupLabel ?? null,
        rangeIndex: control.rangeIndex ?? null,
        blackWhiteRangeIndex: control.blackWhiteRangeIndex ?? null,
        treatment: control.lightTable?.treatment ?? null,
        defaultTreatment: control.lightTable?.defaultTreatment ?? null,
        gradingMode: control.lightTable?.gradingMode ?? null,
        wheelHue: control.lightTable?.wheelHue === 'value'
          ? value : (control.lightTable?.wheelHue ?? null),
        wheelSaturation: control.lightTable?.wheelSaturation === 'value'
          ? value : (control.lightTable?.wheelSaturation ?? null),
        label: control.sliderLabel ?? control.label,
        value,
        defaultValue: control.defaultValue ?? 0
      }]
    });
  }
  return cases;
};

const sortedObject = (value) => {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedObject(value[key])]));
};

const sharedCase = ({ id, key, label, value, baselineId, isBaseline }) => ({
  id, key: key ?? null, label, value: value ?? null, baselineId, isBaseline: Boolean(isBaseline)
});

const lightTableCase = (entry) => ({
  ...sharedCase(entry),
  settings: (entry.settings ?? []).map(sortedObject)
});

export const gradeCorpusSharedCasePlanSha256 = (cases) => sha256Json(
  (cases ?? []).map(sharedCase)
);

export const gradeCorpusLightTableCasePlanSha256 = (cases) => sha256Json(
  (cases ?? []).map(lightTableCase)
);
