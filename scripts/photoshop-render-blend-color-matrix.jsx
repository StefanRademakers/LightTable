#target photoshop

(function () {
  var root = new Folder('D:/Mediavibe/LightTableTests/BlendColorMatrix');
  var jobsFile = new File(root.fsName + '/photoshop-jobs.txt');
  var reportFile = new File(root.fsName + '/photoshop-report.json');
  var previousDialogs = app.displayDialogs;
  var results = [];
  function quote(value) { return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function report(status, error) {
    reportFile.encoding = 'UTF8'; reportFile.open('w');
    reportFile.write('{"status":' + quote(status) + ',"count":' + results.length
      + ',"error":' + quote(error || '') + ',"results":[' + results.join(',') + ']}\n');
    reportFile.close();
  }
  try {
    app.displayDialogs = DialogModes.NO;
    if (!jobsFile.exists) throw new Error('Missing blend color-matrix job list.');
    jobsFile.encoding = 'UTF8'; jobsFile.open('r');
    var lines = jobsFile.read().split(/\r?\n/); jobsFile.close();
    for (var index = 0; index < lines.length; index += 1) {
      if (!lines[index]) continue;
      var fields = lines[index].split('|');
      var source = new File(fields[0]);
      var canonical = new File(fields[1]);
      var reference = new File(fields[2]);
      var profileName = fields[3];
      var bitDepth = Number(fields[4]);
      var embedProfile = fields[5] === '1';
      var document = app.open(source); app.activeDocument = document;
      if (profileName) {
        document.convertProfile('sRGB IEC61966-2.1', Intent.RELATIVECOLORIMETRIC, true, false);
        if (profileName !== 'sRGB IEC61966-2.1') {
          document.convertProfile(profileName, Intent.RELATIVECOLORIMETRIC, true, false);
        }
      }
      document.bitsPerChannel = bitDepth === 16
        ? BitsPerChannelType.SIXTEEN
        : BitsPerChannelType.EIGHT;
      var psd = new PhotoshopSaveOptions();
      psd.layers = true; psd.maximizeCompatibility = true; psd.embedColorProfile = embedProfile;
      document.saveAs(canonical, psd, true, Extension.LOWERCASE);
      var actualProfile = '';
      try { actualProfile = document.colorProfileName; } catch (_) {}
      var rendered = document.duplicate(document.name + '-srgb-render', false);
      // Preserve the document's declared blend domain in the oracle. Profile
      // conversion on a layered document converts every source layer first
      // and would therefore measure sRGB blending instead of Adobe RGB
      // blending. Flatten first, then convert only the composite for the
      // common PNG comparison encoding.
      rendered.flatten();
      try {
        rendered.convertProfile('sRGB IEC61966-2.1', Intent.RELATIVECOLORIMETRIC, true, false);
      } catch (_) {}
      var png = new PNGSaveOptions(); png.compression = 0; png.interlaced = false;
      rendered.saveAs(reference, png, true, Extension.LOWERCASE);
      rendered.close(SaveOptions.DONOTSAVECHANGES);
      results.push('{"canonical":' + quote(canonical.fsName)
        + ',"reference":' + quote(reference.fsName)
        + ',"profile":' + quote(actualProfile)
        + ',"bitsPerChannel":' + quote(document.bitsPerChannel.toString()) + '}');
      document.close(SaveOptions.DONOTSAVECHANGES);
      report('running', '');
    }
    report('passed', '');
  } catch (error) {
    try { while (app.documents.length) app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
    report('failed', error.message || error);
  } finally { app.displayDialogs = previousDialogs; }
}());
