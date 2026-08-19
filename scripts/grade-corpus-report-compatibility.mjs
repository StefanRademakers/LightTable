import {
  gradeCorpusLightTableCasePlanSha256,
  gradeCorpusSharedCasePlanSha256
} from './grade-corpus-case-plan.mjs';

export const parseGradeCorpusReport = (text) => JSON.parse(text.replace(/^\uFEFF/u, ''));

export const gradeCorpusReportsHaveSameCases = (cameraRawReport, lightTableReport) => {
  const cameraRawIds = cameraRawReport?.cases?.map(({ id }) => id) ?? [];
  const lightTableIds = lightTableReport?.cases?.map(({ id }) => id) ?? [];
  return cameraRawIds.length > 0
    && cameraRawIds.length === lightTableIds.length
    && cameraRawIds.every((id, index) => id === lightTableIds[index])
    && (cameraRawReport.sharedCasePlanSha256
      ?? gradeCorpusSharedCasePlanSha256(cameraRawReport.cases))
      === (lightTableReport.sharedCasePlanSha256
        ?? gradeCorpusSharedCasePlanSha256(lightTableReport.cases));
};

export const gradeCorpusReportMatchesCapture = (
  report,
  { section, caseManifestSha256, sourceSha256, lightTableCasePlanSha256 = null }
) => Boolean(
  report
  && report.section === section
  && (report.caseManifestSha256 === caseManifestSha256
    || (lightTableCasePlanSha256 !== null
      && (report.lightTableCasePlanSha256
        ?? gradeCorpusLightTableCasePlanSha256(report.cases)) === lightTableCasePlanSha256))
  && report.sourceEvidence?.sha256 === sourceSha256
  && Array.isArray(report.cases)
  && report.cases.length > 0
);
