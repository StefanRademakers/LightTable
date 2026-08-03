import {
  PDF_DISPLAY_LIST_SCHEMA_VERSION,
  type PdfDisplayOperation,
  type PdfMatrix,
  type PdfNormalizedDisplayList,
  type PdfPaint,
  type PdfPathData,
  type PdfPoint,
  type PdfRect
} from './types';

export interface PdfDisplayListLimits {
  readonly maximumPages: number;
  readonly maximumOperationsPerPage: number;
  readonly maximumGlyphsPerRun: number;
  readonly maximumPathCommands: number;
  readonly maximumResourceCount: number;
  readonly maximumSemanticSpans: number;
  readonly maximumFontProgramBytes: number;
}

export const DEFAULT_PDF_DISPLAY_LIST_LIMITS: PdfDisplayListLimits = Object.freeze({
  maximumPages: 10_000,
  maximumOperationsPerPage: 2_000_000,
  maximumGlyphsPerRun: 1_000_000,
  maximumPathCommands: 5_000_000,
  maximumResourceCount: 1_000_000,
  maximumSemanticSpans: 5_000_000,
  maximumFontProgramBytes: 512 * 1024 * 1024
});

const fail = (path: string, message: string): never => { throw new Error(`${path} ${message}`); };
const finite = (value: number, path: string) => Number.isFinite(value) ? value : fail(path, 'must be finite.');
const unit = (value: number, path: string) => {
  finite(value, path);
  if (value < 0 || value > 1) fail(path, 'must be between zero and one.');
};
const nonNegative = (value: number, path: string) => {
  finite(value, path);
  if (value < 0) fail(path, 'must not be negative.');
};
const matrix = (value: PdfMatrix, path: string) => {
  if (!Array.isArray(value) || value.length !== 6) fail(path, 'must contain six values.');
  value.forEach((part, index) => finite(part, `${path}[${index}]`));
};
const point = (value: PdfPoint, path: string) => {
  finite(value.x, `${path}.x`); finite(value.y, `${path}.y`);
};
const rect = (value: PdfRect, path: string) => {
  point(value, path); nonNegative(value.width, `${path}.width`); nonNegative(value.height, `${path}.height`);
};
const paint = (value: PdfPaint, path: string) => {
  if (value.kind === 'device-gray') unit(value.gray, `${path}.gray`);
  else if (value.kind === 'device-rgb') {
    unit(value.r, `${path}.r`); unit(value.g, `${path}.g`); unit(value.b, `${path}.b`);
  } else if (value.kind === 'device-cmyk') {
    unit(value.c, `${path}.c`); unit(value.m, `${path}.m`); unit(value.y, `${path}.y`); unit(value.k, `${path}.k`);
  } else value.components.forEach((part, index) => finite(part, `${path}.components[${index}]`));
};
const pathData = (value: PdfPathData, path: string, limits: PdfDisplayListLimits) => {
  if (value.commands.length > limits.maximumPathCommands) fail(path, 'exceeds the path-command limit.');
  value.commands.forEach((command, index) => {
    const at = `${path}.commands[${index}]`;
    if (command.kind === 'move' || command.kind === 'line') point(command.point, `${at}.point`);
    else if (command.kind === 'cubic') {
      point(command.control1, `${at}.control1`); point(command.control2, `${at}.control2`); point(command.point, `${at}.point`);
    }
  });
};

const operation = (value: PdfDisplayOperation, path: string, limits: PdfDisplayListLimits) => {
  if (value.kind === 'concat-transform') matrix(value.matrix, `${path}.matrix`);
  else if (value.kind === 'set-fill-paint' || value.kind === 'set-stroke-paint') paint(value.paint, `${path}.paint`);
  else if (value.kind === 'set-alpha') { unit(value.fill, `${path}.fill`); unit(value.stroke, `${path}.stroke`); }
  else if (value.kind === 'set-stroke-state') {
    nonNegative(value.stroke.width, `${path}.stroke.width`);
    nonNegative(value.stroke.miterLimit, `${path}.stroke.miterLimit`);
    value.stroke.dash.forEach((part, index) => nonNegative(part, `${path}.stroke.dash[${index}]`));
    finite(value.stroke.dashPhase, `${path}.stroke.dashPhase`);
  } else if (value.kind === 'clip-path' || value.kind === 'draw-path') pathData(value.path, `${path}.path`, limits);
  else if (value.kind === 'draw-image' || value.kind === 'begin-transparency-group') matrix(value.matrix, `${path}.matrix`);
  else if (value.kind === 'draw-text') value.runs.forEach((run, runIndex) => {
    const runPath = `${path}.runs[${runIndex}]`;
    matrix(run.textMatrix, `${runPath}.textMatrix`);
    [run.fontSize, run.characterSpacing, run.wordSpacing, run.horizontalScale, run.rise]
      .forEach((part, index) => finite(part, `${runPath}.state[${index}]`));
    if (run.glyphs.length > limits.maximumGlyphsPerRun) fail(runPath, 'exceeds the glyph limit.');
    run.glyphs.forEach((glyph, glyphIndex) => {
      const glyphPath = `${runPath}.glyphs[${glyphIndex}]`;
      glyph.sourceCode.forEach((byte, index) => {
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) fail(`${glyphPath}.sourceCode[${index}]`, 'must be a byte.');
      });
      if (glyph.glyphId !== undefined && (!Number.isInteger(glyph.glyphId) || glyph.glyphId < 0)) fail(`${glyphPath}.glyphId`, 'must be a non-negative integer.');
      point(glyph.origin, `${glyphPath}.origin`); point(glyph.advance, `${glyphPath}.advance`); matrix(glyph.glyphMatrix, `${glyphPath}.glyphMatrix`);
    });
  });
};

/** Validates engine output before it can cross into LightTable semantic conversion. */
export const validatePdfDisplayList = (
  value: PdfNormalizedDisplayList,
  limits: PdfDisplayListLimits = DEFAULT_PDF_DISPLAY_LIST_LIMITS
): PdfNormalizedDisplayList => {
  if (value.schemaVersion !== PDF_DISPLAY_LIST_SCHEMA_VERSION) fail('$.schemaVersion', 'is unsupported.');
  if (value.pages.length > limits.maximumPages) fail('$.pages', 'exceeds the page limit.');
  const allResources = [
    ...value.resources.fonts,
    ...value.resources.fontPrograms,
    ...value.resources.semanticMappings,
    ...value.resources.images,
    ...value.resources.colorSpaces,
    ...value.resources.transparencyGroups,
    ...value.resources.softMasks
  ];
  const resourceCount = allResources.length;
  if (resourceCount > limits.maximumResourceCount) fail('$.resources', 'exceeds the resource limit.');
  nonNegative(value.source.byteLength, '$.source.byteLength');
  const resourceIds = new Set<string>();
  for (const resource of allResources) {
    if (resourceIds.has(resource.id)) fail('$.resources', `contains duplicate id ${resource.id}.`);
    resourceIds.add(resource.id);
  }
  const ids = <T extends { readonly id: string }>(resources: readonly T[]) => new Set(resources.map(resource => resource.id));
  const fontIds = ids(value.resources.fonts);
  const fontProgramIds = ids(value.resources.fontPrograms);
  const semanticMappingIds = ids(value.resources.semanticMappings);
  const imageIds = ids(value.resources.images);
  const colorSpaceIds = ids(value.resources.colorSpaces);
  const groupIds = ids(value.resources.transparencyGroups);
  const softMaskIds = ids(value.resources.softMasks);
  const requireResource = (set: ReadonlySet<string>, id: string, path: string, kind: string) => {
    if (!set.has(id)) fail(path, `references missing ${kind} resource ${id}.`);
  };
  value.resources.fonts.forEach((font, index) => {
    if (font.fontProgramResourceId !== null) {
      requireResource(fontProgramIds, font.fontProgramResourceId, `$.resources.fonts[${index}].fontProgramResourceId`, 'font-program');
    }
    if (font.embedding === 'embedded' && font.fontProgramResourceId === null) {
      fail(`$.resources.fonts[${index}].fontProgramResourceId`, 'is required for an embedded font.');
    }
  });
  value.resources.fontPrograms.forEach((program, index) => {
    const programPath = `$.resources.fontPrograms[${index}]`;
    nonNegative(program.byteLength, `${programPath}.byteLength`);
    if (program.byteLength > limits.maximumFontProgramBytes) fail(programPath, 'exceeds the font-program byte limit.');
    if (!/^[a-f0-9]{64}$/i.test(program.fingerprintSha256)) fail(`${programPath}.fingerprintSha256`, 'must be a SHA-256 hex digest.');
  });
  const semanticMappingById = new Map(value.resources.semanticMappings.map(mapping => [mapping.id, mapping]));
  value.resources.semanticMappings.forEach((mapping, index) => {
    const mappingPath = `$.resources.semanticMappings[${index}]`;
    if (mapping.spans.length > limits.maximumSemanticSpans) fail(mappingPath, 'exceeds the semantic-span limit.');
    unit(mapping.logicalOrderConfidence, `${mappingPath}.logicalOrderConfidence`);
    let previousEnd = 0;
    mapping.spans.forEach((span, spanIndex) => {
      const spanPath = `${mappingPath}.spans[${spanIndex}]`;
      if (!Number.isInteger(span.glyphStart) || span.glyphStart < previousEnd) fail(`${spanPath}.glyphStart`, 'must be an ordered non-negative integer.');
      if (!Number.isInteger(span.glyphEnd) || span.glyphEnd <= span.glyphStart) fail(`${spanPath}.glyphEnd`, 'must be greater than glyphStart.');
      unit(span.confidence, `${spanPath}.confidence`);
      previousEnd = span.glyphEnd;
    });
  });
  value.resources.images.forEach((image, index) => {
    const imagePath = `$.resources.images[${index}]`;
    nonNegative(image.width, `${imagePath}.width`);
    nonNegative(image.height, `${imagePath}.height`);
    nonNegative(image.bitsPerComponent, `${imagePath}.bitsPerComponent`);
    if (image.colorSpaceId !== null) requireResource(colorSpaceIds, image.colorSpaceId, `${imagePath}.colorSpaceId`, 'color-space');
    if (image.softMaskResourceId !== null) requireResource(softMaskIds, image.softMaskResourceId, `${imagePath}.softMaskResourceId`, 'soft-mask');
  });
  value.resources.colorSpaces.forEach((colorSpace, index) => {
    nonNegative(colorSpace.componentCount, `$.resources.colorSpaces[${index}].componentCount`);
  });
  value.resources.transparencyGroups.forEach((group, index) => {
    const groupPath = `$.resources.transparencyGroups[${index}]`;
    rect(group.bounds, `${groupPath}.bounds`);
    if (group.colorSpaceId !== null) requireResource(colorSpaceIds, group.colorSpaceId, `${groupPath}.colorSpaceId`, 'color-space');
  });
  value.resources.softMasks.forEach((mask, index) => {
    const maskPath = `$.resources.softMasks[${index}]`;
    requireResource(groupIds, mask.groupResourceId, `${maskPath}.groupResourceId`, 'transparency-group');
    mask.backdrop?.forEach((part, partIndex) => finite(part, `${maskPath}.backdrop[${partIndex}]`));
  });
  const positionedRunIds = new Set<string>();
  value.pages.forEach((page, pageIndex) => {
    const pagePath = `$.pages[${pageIndex}]`;
    if (page.pageIndex !== pageIndex) fail(`${pagePath}.pageIndex`, 'must be contiguous and zero-based.');
    rect(page.mediaBox, `${pagePath}.mediaBox`); rect(page.cropBox, `${pagePath}.cropBox`);
    if (!(page.userUnit > 0)) fail(`${pagePath}.userUnit`, 'must be greater than zero.');
    if (page.operations.length > limits.maximumOperationsPerPage) fail(`${pagePath}.operations`, 'exceeds the operation limit.');
    let stateDepth = 0;
    let markedDepth = 0;
    const groups: string[] = [];
    page.operations.forEach((entry, index) => {
      const operationPath = `${pagePath}.operations[${index}]`;
      operation(entry, operationPath, limits);
      if (entry.kind === 'draw-image') requireResource(imageIds, entry.imageResourceId, `${operationPath}.imageResourceId`, 'image');
      else if (entry.kind === 'draw-text') entry.runs.forEach((run, runIndex) => {
        const runPath = `${operationPath}.runs[${runIndex}]`;
        if (!run.id) fail(`${runPath}.id`, 'must not be empty.');
        if (positionedRunIds.has(run.id)) fail(`${runPath}.id`, `duplicates positioned run ${run.id}.`);
        positionedRunIds.add(run.id);
        requireResource(fontIds, run.fontResourceId, `${runPath}.fontResourceId`, 'font');
        if (run.semanticMappingResourceId !== null) {
          requireResource(semanticMappingIds, run.semanticMappingResourceId, `${runPath}.semanticMappingResourceId`, 'semantic-mapping');
          const mapping = semanticMappingById.get(run.semanticMappingResourceId)!;
          if (mapping.positionedRunId !== run.id) fail(`${runPath}.semanticMappingResourceId`, 'does not target this positioned run.');
          mapping.spans.forEach((span, spanIndex) => {
            if (span.glyphEnd > run.glyphs.length) fail(`${runPath}.semanticMappingResourceId`, `span ${spanIndex} exceeds the glyph count.`);
          });
        }
      });
      else if (entry.kind === 'set-fill-paint' || entry.kind === 'set-stroke-paint') {
        if (entry.paint.kind === 'resource') requireResource(colorSpaceIds, entry.paint.colorSpaceId, `${operationPath}.paint.colorSpaceId`, 'color-space');
      } else if (entry.kind === 'begin-transparency-group') {
        requireResource(groupIds, entry.groupResourceId, `${operationPath}.groupResourceId`, 'transparency-group');
      } else if (entry.kind === 'apply-soft-mask' && entry.softMaskResourceId !== null) {
        requireResource(softMaskIds, entry.softMaskResourceId, `${operationPath}.softMaskResourceId`, 'soft-mask');
      }
      if (entry.kind === 'save-state') stateDepth += 1;
      else if (entry.kind === 'restore-state' && --stateDepth < 0) fail(operationPath, 'restores an empty graphics-state stack.');
      else if (entry.kind === 'begin-marked-content') markedDepth += 1;
      else if (entry.kind === 'end-marked-content' && --markedDepth < 0) fail(operationPath, 'ends an empty marked-content stack.');
      else if (entry.kind === 'begin-transparency-group') groups.push(entry.groupResourceId);
      else if (entry.kind === 'end-transparency-group' && groups.pop() !== entry.groupResourceId) fail(operationPath, 'does not match the active transparency group.');
    });
    if (stateDepth !== 0) fail(`${pagePath}.operations`, 'leaves graphics state unbalanced.');
    if (markedDepth !== 0) fail(`${pagePath}.operations`, 'leaves marked content unbalanced.');
    if (groups.length !== 0) fail(`${pagePath}.operations`, 'leaves transparency groups unbalanced.');
  });
  return value;
};
