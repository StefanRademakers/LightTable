export const parseGradeCorpusReport = (text) => JSON.parse(text.replace(/^\uFEFF/u, ''));

export const gradeCorpusReportsHaveSameCases = (cameraRawReport, lightTableReport) => {
  if (!cameraRawReport?.caseManifestSha256
    || cameraRawReport.caseManifestSha256 !== lightTableReport?.caseManifestSha256) {
    return false;
  }
  const cameraRawIds = cameraRawReport?.cases?.map(({ id }) => id) ?? [];
  const lightTableIds = lightTableReport?.cases?.map(({ id }) => id) ?? [];
  return cameraRawIds.length > 0
    && cameraRawIds.length === lightTableIds.length
    && cameraRawIds.every((id, index) => id === lightTableIds[index]);
};
