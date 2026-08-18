export const parseGradeCorpusRunMode = (args) => {
  const lightTableOnly = args.includes('--lighttable-only');
  const cameraRawOnly = args.includes('--camera-raw-only');
  if (lightTableOnly && cameraRawOnly) {
    throw new Error('Choose either --lighttable-only or --camera-raw-only, not both.');
  }
  return {
    captureCameraRaw: !lightTableOnly,
    captureLightTable: !cameraRawOnly
  };
};
