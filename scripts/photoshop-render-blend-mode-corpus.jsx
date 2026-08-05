#target photoshop

(function () {
  var root = new Folder('D:/Mediavibe/LightTableTests/BlendModes');
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
    if (!jobsFile.exists) throw new Error('Missing blend-mode job list.');
    jobsFile.encoding = 'UTF8'; jobsFile.open('r');
    var lines = jobsFile.read().split(/\r?\n/); jobsFile.close();
    for (var index = 0; index < lines.length; index += 1) {
      if (!lines[index]) continue;
      var fields = lines[index].split('|');
      var source = new File(fields[0]); var canonical = new File(fields[1]); var reference = new File(fields[2]);
      var document = app.open(source); app.activeDocument = document;
      var rendered = document.duplicate(document.name + '-render', false); rendered.flatten();
      var png = new PNGSaveOptions(); png.compression = 0; png.interlaced = false;
      rendered.saveAs(reference, png, true, Extension.LOWERCASE);
      rendered.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = document;
      var psd = new PhotoshopSaveOptions(); psd.layers = true; psd.maximizeCompatibility = true;
      psd.embedColorProfile = true; document.saveAs(canonical, psd, true, Extension.LOWERCASE);
      results.push('{"source":' + quote(source.fsName) + ',"canonical":' + quote(canonical.fsName)
        + ',"reference":' + quote(reference.fsName) + '}');
      document.close(SaveOptions.DONOTSAVECHANGES); report('running', '');
    }
    report('passed', '');
  } catch (error) {
    try { while (app.documents.length) app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
    report('failed', error.message || error);
  } finally { app.displayDialogs = previousDialogs; }
}());
