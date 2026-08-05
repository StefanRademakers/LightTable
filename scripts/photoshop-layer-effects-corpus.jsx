#target photoshop

(function () {
  var root = new Folder('D:/mediavibe/LightTableTestFiles/psd/layer-effects-roundtrip');
  var jobsFile = new File(root.fsName + '/photoshop-jobs.txt');
  var reportFile = new File(root.fsName + '/photoshop-report.json');
  var previousDialogs = app.displayDialogs;
  var results = [];

  function quote(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  function report(status, error) {
    reportFile.encoding = 'UTF8'; reportFile.open('w');
    reportFile.write('{"status":' + quote(status) + ',"count":' + results.length
      + ',"error":' + quote(error || '') + ',"results":[' + results.join(',') + ']}\n');
    reportFile.close();
  }
  function ensureParent(file) { if (!file.parent.exists) file.parent.create(); }

  try {
    app.displayDialogs = DialogModes.NO;
    if (!jobsFile.exists) throw new Error('Missing Photoshop job list: ' + jobsFile.fsName);
    jobsFile.encoding = 'UTF8'; jobsFile.open('r');
    var lines = jobsFile.read().split(/\r?\n/); jobsFile.close();
    for (var index = 0; index < lines.length; index += 1) {
      if (!lines[index]) continue;
      var fields = lines[index].split('|');
      var source = new File(fields[0]);
      var canonical = new File(fields[1]);
      var reference = new File(fields[2]);
      ensureParent(canonical); ensureParent(reference);
      var document = app.open(source);
      app.activeDocument = document;
      // Do not use mergeLayersOnly=true here: on freshly written fixtures
      // Photoshop may then reuse the embedded compatibility composite, which
      // is intentionally stale and does not contain live layer effects.
      var rendered = document.duplicate(document.name + '-render', false);
      rendered.flatten();
      var png = new PNGSaveOptions(); png.compression = 0; png.interlaced = false;
      rendered.saveAs(reference, png, true, Extension.LOWERCASE);
      rendered.close(SaveOptions.DONOTSAVECHANGES);
      app.activeDocument = document;
      var psd = new PhotoshopSaveOptions();
      psd.alphaChannels = true; psd.annotations = true; psd.embedColorProfile = true;
      psd.layers = true; psd.maximizeCompatibility = true; psd.spotColors = true;
      document.saveAs(canonical, psd, true, Extension.LOWERCASE);
      results.push('{"source":' + quote(source.fsName) + ',"canonical":'
        + quote(canonical.fsName) + ',"reference":' + quote(reference.fsName) + '}');
      document.close(SaveOptions.DONOTSAVECHANGES);
    }
    report('passed', '');
  } catch (error) {
    try { if (app.documents.length) app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
    report('failed', error.message || error);
  } finally {
    app.displayDialogs = previousDialogs;
  }
}());
