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
  readonly maximumTotalOperations: number;
  readonly maximumTotalGlyphs: number;
  readonly maximumTotalPathCommands: number;
  readonly maximumTotalImagePixels: number;
  readonly maximumTotalFontProgramBytes: number;
  readonly maximumType3GlyphPrograms: number;
  readonly maximumType3OperationsPerGlyph: number;
  readonly maximumType3NestingDepth: number;
}

export const DEFAULT_PDF_DISPLAY_LIST_LIMITS: PdfDisplayListLimits = Object.freeze({
  maximumPages: 10_000,
  maximumOperationsPerPage: 2_000_000,
  maximumGlyphsPerRun: 1_000_000,
  maximumPathCommands: 5_000_000,
  maximumResourceCount: 1_000_000,
  maximumSemanticSpans: 5_000_000,
  maximumFontProgramBytes: 512 * 1024 * 1024,
  maximumTotalOperations: 10_000_000,
  maximumTotalGlyphs: 20_000_000,
  maximumTotalPathCommands: 20_000_000,
  maximumTotalImagePixels: 2_000_000_000,
  maximumTotalFontProgramBytes: 1024 * 1024 * 1024,
  maximumType3GlyphPrograms: 65_536,
  maximumType3OperationsPerGlyph: 100_000,
  maximumType3NestingDepth: 16
});

interface PdfValidationBudget {
  operations: number;
  glyphs: number;
  pathCommands: number;
}

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
const pathData = (value: PdfPathData, path: string, limits: PdfDisplayListLimits, budget: PdfValidationBudget) => {
  if (value.commands.length > limits.maximumPathCommands) fail(path, 'exceeds the path-command limit.');
  budget.pathCommands += value.commands.length;
  if (budget.pathCommands > limits.maximumTotalPathCommands) fail(path, 'exceeds the document path-command budget.');
  value.commands.forEach((command, index) => {
    const at = `${path}.commands[${index}]`;
    if (command.kind === 'move' || command.kind === 'line') point(command.point, `${at}.point`);
    else if (command.kind === 'cubic') {
      point(command.control1, `${at}.control1`); point(command.control2, `${at}.control2`); point(command.point, `${at}.point`);
    }
  });
};

const operation = (value: PdfDisplayOperation, path: string, limits: PdfDisplayListLimits, budget: PdfValidationBudget) => {
  if (value.kind === 'concat-transform') matrix(value.matrix, `${path}.matrix`);
  else if (value.kind === 'set-fill-paint' || value.kind === 'set-stroke-paint') paint(value.paint, `${path}.paint`);
  else if (value.kind === 'set-alpha') { unit(value.fill, `${path}.fill`); unit(value.stroke, `${path}.stroke`); }
  else if (value.kind === 'set-stroke-state') {
    nonNegative(value.stroke.width, `${path}.stroke.width`);
    nonNegative(value.stroke.miterLimit, `${path}.stroke.miterLimit`);
    value.stroke.dash.forEach((part, index) => nonNegative(part, `${path}.stroke.dash[${index}]`));
    finite(value.stroke.dashPhase, `${path}.stroke.dashPhase`);
  } else if (value.kind === 'clip-path' || value.kind === 'draw-path') pathData(value.path, `${path}.path`, limits, budget);
  else if (value.kind === 'draw-image' || value.kind === 'begin-transparency-group') matrix(value.matrix, `${path}.matrix`);
  else if (value.kind === 'draw-text') value.runs.forEach((run, runIndex) => {
    const runPath = `${path}.runs[${runIndex}]`;
    matrix(run.textMatrix, `${runPath}.textMatrix`);
    [run.fontSize, run.characterSpacing, run.wordSpacing, run.horizontalScale, run.rise]
      .forEach((part, index) => finite(part, `${runPath}.state[${index}]`));
    if (run.glyphs.length > limits.maximumGlyphsPerRun) fail(runPath, 'exceeds the glyph limit.');
    budget.glyphs += run.glyphs.length;
    if (budget.glyphs > limits.maximumTotalGlyphs) fail(runPath, 'exceeds the document glyph budget.');
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
  limitOverrides: Partial<PdfDisplayListLimits> = {}
): PdfNormalizedDisplayList => {
  const limits: PdfDisplayListLimits = { ...DEFAULT_PDF_DISPLAY_LIST_LIMITS, ...limitOverrides };
  const budget: PdfValidationBudget = { operations: 0, glyphs: 0, pathCommands: 0 };
  if (value.schemaVersion !== PDF_DISPLAY_LIST_SCHEMA_VERSION) fail('$.schemaVersion', 'is unsupported.');
  if (value.pages.length > limits.maximumPages) fail('$.pages', 'exceeds the page limit.');
  const allResources = [
    ...value.resources.fonts,
    ...value.resources.fontPrograms,
    ...value.resources.semanticMappings,
    ...value.resources.type3GlyphPrograms,
    ...value.resources.images,
    ...value.resources.colorSpaces,
    ...value.resources.transparencyGroups,
    ...value.resources.softMasks
  ];
  const resourceCount = allResources.length;
  if (resourceCount > limits.maximumResourceCount) fail('$.resources', 'exceeds the resource limit.');
  nonNegative(value.source.byteLength, '$.source.byteLength');
  if (!value.source.originalAssetId) fail('$.source.originalAssetId', 'must reference preserved original bytes.');
  if (!/^[a-f0-9]{64}$/i.test(value.source.fingerprintSha256)) {
    fail('$.source.fingerprintSha256', 'must be a SHA-256 hex digest.');
  }
  if (value.source.format === 'pdf' && value.source.nativeAiData !== 'absent') {
    fail('$.source.nativeAiData', 'requires PDF-compatible Illustrator source format.');
  }
  const resourceIds = new Set<string>();
  for (const resource of allResources) {
    if (resourceIds.has(resource.id)) fail('$.resources', `contains duplicate id ${resource.id}.`);
    resourceIds.add(resource.id);
  }
  const ids = <T extends { readonly id: string }>(resources: readonly T[]) => new Set(resources.map(resource => resource.id));
  const fontIds = ids(value.resources.fonts);
  const fontProgramIds = ids(value.resources.fontPrograms);
  const semanticMappingIds = ids(value.resources.semanticMappings);
  const type3GlyphProgramIds = ids(value.resources.type3GlyphPrograms);
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
      if (font.subtype !== 'type3') fail(`$.resources.fonts[${index}].fontProgramResourceId`, 'is required for an embedded font.');
    }
    const ownedType3Programs = new Set<string>();
    font.type3GlyphProgramResourceIds.forEach((id, programIndex) => {
      if (ownedType3Programs.has(id)) {
        fail(`$.resources.fonts[${index}].type3GlyphProgramResourceIds[${programIndex}]`, 'duplicates a Type 3 glyph-program reference.');
      }
      ownedType3Programs.add(id);
      requireResource(type3GlyphProgramIds, id, `$.resources.fonts[${index}].type3GlyphProgramResourceIds[${programIndex}]`, 'Type 3 glyph-program');
    });
    if (font.subtype !== 'type3' && font.type3GlyphProgramResourceIds.length > 0) {
      fail(`$.resources.fonts[${index}].type3GlyphProgramResourceIds`, 'must be empty for a non-Type 3 font.');
    }
  });
  let totalFontProgramBytes = 0;
  value.resources.fontPrograms.forEach((program, index) => {
    const programPath = `$.resources.fontPrograms[${index}]`;
    nonNegative(program.byteLength, `${programPath}.byteLength`);
    if (program.byteLength > limits.maximumFontProgramBytes) fail(programPath, 'exceeds the font-program byte limit.');
    totalFontProgramBytes += program.byteLength;
    if (totalFontProgramBytes > limits.maximumTotalFontProgramBytes) fail(programPath, 'exceeds the document font-program byte budget.');
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
  const totalImagePixels = value.resources.images.reduce((total, image, index) => {
    const pixels = image.width * image.height;
    if (!Number.isSafeInteger(pixels)) fail(`$.resources.images[${index}]`, 'has unsafe pixel dimensions.');
    return total + pixels;
  }, 0);
  if (totalImagePixels > limits.maximumTotalImagePixels) fail('$.resources.images', 'exceeds the document image-pixel budget.');
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
  const validateOperationResources = (entry: PdfDisplayOperation, operationPath: string) => {
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
  };
  const validateOperationSequence = (
    operations: readonly PdfDisplayOperation[],
    sequencePath: string,
    maximumOperations: number
  ) => {
    if (operations.length > maximumOperations) fail(sequencePath, 'exceeds the operation limit.');
    budget.operations += operations.length;
    if (budget.operations > limits.maximumTotalOperations) fail(sequencePath, 'exceeds the document operation budget.');
    let stateDepth = 0;
    let markedDepth = 0;
    const groups: string[] = [];
    operations.forEach((entry, index) => {
      const operationPath = `${sequencePath}[${index}]`;
      operation(entry, operationPath, limits, budget);
      validateOperationResources(entry, operationPath);
      if (entry.kind === 'save-state') stateDepth += 1;
      else if (entry.kind === 'restore-state' && --stateDepth < 0) fail(operationPath, 'restores an empty graphics-state stack.');
      else if (entry.kind === 'begin-marked-content') markedDepth += 1;
      else if (entry.kind === 'end-marked-content' && --markedDepth < 0) fail(operationPath, 'ends an empty marked-content stack.');
      else if (entry.kind === 'begin-transparency-group') groups.push(entry.groupResourceId);
      else if (entry.kind === 'end-transparency-group' && groups.pop() !== entry.groupResourceId) fail(operationPath, 'does not match the active transparency group.');
    });
    if (stateDepth !== 0) fail(sequencePath, 'leaves graphics state unbalanced.');
    if (markedDepth !== 0) fail(sequencePath, 'leaves marked content unbalanced.');
    if (groups.length !== 0) fail(sequencePath, 'leaves transparency groups unbalanced.');
  };

  if (value.resources.type3GlyphPrograms.length > limits.maximumType3GlyphPrograms) {
    fail('$.resources.type3GlyphPrograms', 'exceeds the Type 3 glyph-program limit.');
  }
  const fontById = new Map(value.resources.fonts.map(font => [font.id, font]));
  const type3ProgramsByFont = new Map<string, typeof value.resources.type3GlyphPrograms[number][]>();
  value.resources.type3GlyphPrograms.forEach((program, index) => {
    const programPath = `$.resources.type3GlyphPrograms[${index}]`;
    requireResource(fontIds, program.fontResourceId, `${programPath}.fontResourceId`, 'font');
    const font = fontById.get(program.fontResourceId)!;
    if (font.subtype !== 'type3') fail(`${programPath}.fontResourceId`, 'must reference a Type 3 font.');
    if (!font.type3GlyphProgramResourceIds.includes(program.id)) fail(programPath, 'is not owned by its Type 3 font.');
    if (!Number.isInteger(program.glyphId) || program.glyphId < 0) fail(`${programPath}.glyphId`, 'must be a non-negative integer.');
    program.sourceCode.forEach((byte, byteIndex) => {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) fail(`${programPath}.sourceCode[${byteIndex}]`, 'must be a byte.');
    });
    point(program.advance, `${programPath}.advance`);
    if (program.bounds !== null) rect(program.bounds, `${programPath}.bounds`);
    validateOperationSequence(program.operations, `${programPath}.operations`, limits.maximumType3OperationsPerGlyph);
    const programs = type3ProgramsByFont.get(program.fontResourceId) ?? [];
    programs.push(program);
    type3ProgramsByFont.set(program.fontResourceId, programs);
  });
  const type3ProgramById = new Map(value.resources.type3GlyphPrograms.map(program => [program.id, program]));
  const type3DepthByProgram = new Map<string, number>();
  const type3Depth = (programId: string, active: ReadonlySet<string>): number => {
    if (active.has(programId)) fail('$.resources.type3GlyphPrograms', `contains recursive Type 3 program ${programId}.`);
    const cached = type3DepthByProgram.get(programId);
    if (cached !== undefined) return cached;
    const program = type3ProgramById.get(programId)!;
    const nextActive = new Set(active); nextActive.add(programId);
    const nestedProgramIds = program.operations.flatMap(entry => entry.kind === 'draw-text'
      ? entry.runs.flatMap(run => (type3ProgramsByFont.get(run.fontResourceId) ?? [])
        .filter(candidate => run.glyphs.some(glyph => glyph.glyphId !== undefined
          ? glyph.glyphId === candidate.glyphId
          : glyph.sourceCode.length === candidate.sourceCode.length
            && glyph.sourceCode.every((byte, index) => byte === candidate.sourceCode[index])))
        .map(candidate => candidate.id))
      : []);
    const depth = 1 + nestedProgramIds
      .reduce((maximum, nestedProgramId) => Math.max(maximum, type3Depth(nestedProgramId, nextActive)), 0);
    type3DepthByProgram.set(programId, depth);
    return depth;
  };
  value.resources.type3GlyphPrograms.forEach(program => {
    if (type3Depth(program.id, new Set()) > limits.maximumType3NestingDepth) {
      fail('$.resources.type3GlyphPrograms', 'exceeds the Type 3 nesting limit.');
    }
  });

  value.pages.forEach((page, pageIndex) => {
    const pagePath = `$.pages[${pageIndex}]`;
    if (page.pageIndex !== pageIndex) fail(`${pagePath}.pageIndex`, 'must be contiguous and zero-based.');
    rect(page.mediaBox, `${pagePath}.mediaBox`); rect(page.cropBox, `${pagePath}.cropBox`);
    if (!(page.userUnit > 0)) fail(`${pagePath}.userUnit`, 'must be greater than zero.');
    validateOperationSequence(page.operations, `${pagePath}.operations`, limits.maximumOperationsPerPage);
  });
  return value;
};
