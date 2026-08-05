#target photoshop

(function () {
  var root = new Folder('D:/Mediavibe/LightTableTests/PsdCompare');
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
      var output = new File(fields[1]);
      ensureParent(output);
      var document = app.open(source);
      app.activeDocument = document;
      var rendered = document.duplicate(document.name + '-visual-reference', false);
      rendered.flatten();
      var png = new PNGSaveOptions(); png.compression = 0; png.interlaced = false;
      rendered.saveAs(output, png, true, Extension.LOWERCASE);
      rendered.close(SaveOptions.DONOTSAVECHANGES);
      document.close(SaveOptions.DONOTSAVECHANGES);
      results.push('{"source":' + quote(source.fsName) + ',"output":' + quote(output.fsName) + '}');
      report('running', '');
    }
    report('passed', '');
  } catch (error) {
    try { while (app.documents.length) app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
    report('failed', error.message || error);
  } finally {
    app.displayDialogs = previousDialogs;
  }
}());
