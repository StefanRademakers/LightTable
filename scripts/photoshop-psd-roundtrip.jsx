#target photoshop

(function () {
  var root = new Folder('D:/mediavibe/LightTable/tmp/psd-roundtrip');
  var report = new File(root.fsName + '/photoshop-report.json');
  var previousDialogs = app.displayDialogs;
  var document = null;

  function quote(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function writeReport(body) {
    report.encoding = 'UTF8';
    report.open('w');
    report.write(body);
    report.close();
  }

  function collectLayers(container, depth, output) {
    for (var index = 0; index < container.layers.length; index += 1) {
      var layer = container.layers[index];
      var kind = layer.typename;
      if (layer.typename === 'ArtLayer') {
        try { kind += ':' + layer.kind.toString(); } catch (_) {}
      }
      output.push(
        '{"depth":' + depth
          + ',"name":' + quote(layer.name)
          + ',"kind":' + quote(kind)
          + ',"visible":' + (layer.visible ? 'true' : 'false') + '}'
      );
      if (layer.typename === 'LayerSet') collectLayers(layer, depth + 1, output);
    }
  }

  function renderPng(source, output) {
    var opened = app.open(source);
    app.activeDocument = opened;
    var options = new PNGSaveOptions();
    options.compression = 0;
    options.interlaced = false;
    opened.saveAs(output, options, true, Extension.LOWERCASE);
    opened.close(SaveOptions.DONOTSAVECHANGES);
  }

  try {
    app.displayDialogs = DialogModes.NO;
    if (!root.exists) throw new Error('Roundtrip directory does not exist: ' + root.fsName);
    var candidates = root.getFiles(function (entry) {
      return entry instanceof File && /-lighttable-\d+\.psd$/i.test(entry.name);
    });
    if (!candidates.length) throw new Error('No LightTable PSD fixture was found.');
    candidates.sort(function (left, right) { return right.modified - left.modified; });
    var source = candidates[0];
    var output = new File(root.fsName + '/' + source.name.replace(/\.psd$/i, '-photoshop.psd'));
    var candidatePng = new File(root.fsName + '/' + source.name.replace(/\.psd$/i, '-photoshop-render.png'));
    renderPng(source, candidatePng);
    document = app.open(source);
    app.activeDocument = document;
    var layers = [];
    collectLayers(document, 0, layers);
    var options = new PhotoshopSaveOptions();
    options.alphaChannels = true;
    options.annotations = true;
    options.embedColorProfile = true;
    options.layers = true;
    options.maximizeCompatibility = true;
    options.spotColors = true;
    document.saveAs(output, options, true, Extension.LOWERCASE);
    var body = '{\n'
      + '  "status":"passed",\n'
      + '  "source":' + quote(source.fsName) + ',\n'
      + '  "output":' + quote(output.fsName) + ',\n'
      + '  "candidateRender":' + quote(candidatePng.fsName) + ',\n'
      + '  "width":' + document.width.as('px') + ',\n'
      + '  "height":' + document.height.as('px') + ',\n'
      + '  "mode":' + quote(document.mode.toString()) + ',\n'
      + '  "bitsPerChannel":' + quote(document.bitsPerChannel.toString()) + ',\n'
      + '  "layers":[\n    ' + layers.join(',\n    ') + '\n  ]\n'
      + '}\n';
    writeReport(body);
  } catch (error) {
    writeReport('{"status":"failed","error":' + quote(error.message || error) + '}\n');
  } finally {
    if (document) {
      try { document.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
    }
    app.displayDialogs = previousDialogs;
  }
}());
