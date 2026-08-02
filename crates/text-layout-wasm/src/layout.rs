use std::{cell::RefCell, collections::HashMap};

use fontique::Blob;
use icu_segmenter::GraphemeClusterSegmenter;
use parley::{
    Alignment, AlignmentOptions, FontContext, FontFamily, FontStyle, FontWeight, FontWidth,
    LayoutContext, StyleProperty,
};
use skrifa::{
    FontRef, MetadataProvider,
    instance::{LocationRef, NormalizedCoord, Size},
    raw::types::GlyphId,
};

const MAX_SESSIONS: usize = 16;
const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STYLE_RUNS: usize = 100_000;

#[derive(Default)]
struct SessionEngine {
    fonts: FontContext,
    layout: LayoutContext<u32>,
    registered_assets: HashMap<String, RegisteredAsset>,
}

struct RegisteredAsset {
    face_count: usize,
    blob_id: u64,
}

thread_local! {
    static SESSIONS: RefCell<HashMap<String, SessionEngine>> = RefCell::new(HashMap::new());
}

pub(crate) struct FlowLayoutInput {
    pub(crate) key: String,
    pub(crate) text: String,
    pub(crate) styles: Vec<FlowStyleInput>,
    pub(crate) max_width: Option<f32>,
    pub(crate) origin_x: f32,
    pub(crate) origin_y: f32,
    pub(crate) max_glyph_count: usize,
}

pub(crate) struct FlowStyleInput {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) family: String,
    pub(crate) font_size: f32,
    pub(crate) font_weight: f32,
    pub(crate) font_stretch: f32,
    pub(crate) font_style: FontStyle,
    pub(crate) tracking: f32,
    pub(crate) source_run_index: u32,
    pub(crate) expected_asset_id: String,
    pub(crate) expected_face_index: u32,
}

pub(crate) struct FlowLayoutOutput {
    key: String,
    runs: Vec<OutputRun>,
    lines: Vec<OutputLine>,
    caret_stops: Vec<OutputCaret>,
    selection_geometry: Vec<OutputSelection>,
    cluster_map: Vec<OutputCluster>,
    ink_bounds: OutputRect,
    logical_bounds: OutputRect,
    grapheme_stops: Vec<usize>,
    glyph_count: usize,
}

struct OutputRun {
    source_run_index: u32,
    direction: &'static str,
    resolved_exact: bool,
    glyph_ids: Vec<u32>,
    clusters: Vec<u32>,
    geometry: Vec<f32>,
}

struct OutputLine {
    start: usize,
    end: usize,
    baseline: f32,
    ascent: f32,
    descent: f32,
    bounds: OutputRect,
}

struct OutputCaret {
    text_offset: usize,
    x: f32,
    y: f32,
    height: f32,
    affinity: &'static str,
}

struct OutputSelection {
    start: usize,
    end: usize,
    bounds: OutputRect,
}

struct OutputCluster {
    text_start: usize,
    text_end: usize,
    glyph_start: usize,
    glyph_end: usize,
}

#[derive(Clone, Copy, Default)]
struct OutputRect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

struct LogicalCluster {
    source_run_index: u32,
    direction: &'static str,
    resolved_exact: bool,
    text_start: usize,
    text_end: usize,
    bounds: OutputRect,
    start_x: f32,
    end_x: f32,
    glyph_ids: Vec<u32>,
    geometry: Vec<f32>,
}

fn utf16_boundaries(text: &str) -> Vec<(usize, usize)> {
    let mut result = Vec::with_capacity(text.chars().count() + 1);
    let mut utf16 = 0;
    for (byte, character) in text.char_indices() {
        result.push((byte, utf16));
        utf16 += character.len_utf16();
    }
    result.push((text.len(), utf16));
    result
}

fn utf16_to_byte_fast(boundaries: &[(usize, usize)], offset: usize) -> Option<usize> {
    boundaries
        .binary_search_by_key(&offset, |(_, utf16)| *utf16)
        .ok()
        .map(|index| boundaries[index].0)
}

fn byte_to_utf16_fast(boundaries: &[(usize, usize)], offset: usize) -> Result<usize, String> {
    boundaries
        .binary_search_by_key(&offset, |(byte, _)| *byte)
        .ok()
        .map(|index| boundaries[index].1)
        .ok_or_else(|| "layout offset is not a Unicode scalar boundary".to_owned())
}

pub(crate) fn register_font(
    session_key: &str,
    asset_id: &str,
    bytes: &[u8],
) -> Result<usize, String> {
    if session_key.is_empty() || asset_id.is_empty() {
        return Err("font registration requires session and asset identities".to_owned());
    }
    SESSIONS.with_borrow_mut(|sessions| {
        if !sessions.contains_key(session_key) && sessions.len() >= MAX_SESSIONS {
            return Err(format!(
                "layout engine exceeds the {MAX_SESSIONS} session limit"
            ));
        }
        let session = sessions.entry(session_key.to_owned()).or_default();
        if let Some(asset) = session.registered_assets.get(asset_id) {
            return Ok(asset.face_count);
        }
        let blob = Blob::from(bytes.to_vec());
        let blob_id = blob.id();
        let registered = session
            .fonts
            .collection
            .register_fonts(blob, None)
            .iter()
            .map(|(_, faces)| faces.len())
            .sum();
        if registered == 0 {
            return Err("Fontique did not discover a usable font face".to_owned());
        }
        session.registered_assets.insert(
            asset_id.to_owned(),
            RegisteredAsset {
                face_count: registered,
                blob_id,
            },
        );
        Ok(registered)
    })
}

pub(crate) fn drop_session(session_key: &str) -> bool {
    SESSIONS.with_borrow_mut(|sessions| sessions.remove(session_key).is_some())
}

pub(crate) fn realize_flow(
    session_key: &str,
    input: FlowLayoutInput,
) -> Result<FlowLayoutOutput, String> {
    validate_input(&input)?;
    if input.text.is_empty() {
        return Ok(FlowLayoutOutput {
            key: input.key,
            runs: Vec::new(),
            lines: Vec::new(),
            caret_stops: Vec::new(),
            selection_geometry: Vec::new(),
            cluster_map: Vec::new(),
            ink_bounds: OutputRect::default(),
            logical_bounds: OutputRect {
                x: input.origin_x,
                y: input.origin_y,
                ..OutputRect::default()
            },
            grapheme_stops: vec![0],
            glyph_count: 0,
        });
    }
    SESSIONS.with_borrow_mut(|sessions| {
        let session = sessions
            .get_mut(session_key)
            .ok_or_else(|| "layout session has no registered fonts".to_owned())?;
        let mut builder =
            session
                .layout
                .ranged_builder(&mut session.fonts, &input.text, 1.0, false);
        builder.push_default(StyleProperty::FontSize(16.0));
        let boundaries = utf16_boundaries(&input.text);
        for style in &input.styles {
            let start = utf16_to_byte_fast(&boundaries, style.start)
                .ok_or_else(|| "style start splits a Unicode scalar".to_owned())?;
            let end = utf16_to_byte_fast(&boundaries, style.end)
                .ok_or_else(|| "style end splits a Unicode scalar".to_owned())?;
            if start >= end || end > input.text.len() || style.family.trim().is_empty() {
                return Err("style ranges and family names must be valid".to_owned());
            }
            let range = start..end;
            builder.push(FontFamily::named(&style.family), range.clone());
            builder.push(StyleProperty::FontSize(style.font_size), range.clone());
            builder.push(
                StyleProperty::FontWeight(FontWeight::new(style.font_weight)),
                range.clone(),
            );
            builder.push(
                StyleProperty::FontWidth(FontWidth::from_ratio(style.font_stretch / 100.0)),
                range.clone(),
            );
            builder.push(StyleProperty::FontStyle(style.font_style), range.clone());
            builder.push(StyleProperty::LetterSpacing(style.tracking), range.clone());
            builder.push(StyleProperty::Brush(style.source_run_index), range);
        }
        let mut layout = builder.build(&input.text);
        layout.break_all_lines(input.max_width);
        layout.align(Alignment::Start, AlignmentOptions::default());
        project_layout(&input, &layout, &session.registered_assets)
    })
}

fn validate_input(input: &FlowLayoutInput) -> Result<(), String> {
    if input.text.len() > MAX_TEXT_BYTES {
        return Err(format!(
            "text exceeds the {MAX_TEXT_BYTES} byte layout limit"
        ));
    }
    if input.max_glyph_count == 0 || input.max_glyph_count > 1_000_000 {
        return Err("maxGlyphCount must be between 1 and 1000000".to_owned());
    }
    if input.styles.is_empty() && !input.text.is_empty() {
        return Err("non-empty text requires at least one style run".to_owned());
    }
    if input.styles.len() > MAX_STYLE_RUNS {
        return Err(format!(
            "layout exceeds the {MAX_STYLE_RUNS} style-run limit"
        ));
    }
    let text_utf16_len = input.text.encode_utf16().count();
    let mut expected_start = 0;
    for style in &input.styles {
        if style.start != expected_start
            || style.end < style.start
            || style.end > text_utf16_len
            || style.family.trim().is_empty()
            || style.expected_asset_id.is_empty()
            || !style.font_size.is_finite()
            || style.font_size <= 0.0
            || !style.font_weight.is_finite()
            || !style.font_stretch.is_finite()
            || style.font_stretch <= 0.0
            || !style.tracking.is_finite()
        {
            return Err(
                "style runs must be contiguous, finite and cover valid UTF-16 ranges".to_owned(),
            );
        }
        expected_start = style.end;
    }
    if !input.styles.is_empty() && expected_start != text_utf16_len {
        return Err("style runs must cover the complete text".to_owned());
    }
    if !input.origin_x.is_finite()
        || !input.origin_y.is_finite()
        || input
            .max_width
            .is_some_and(|width| !width.is_finite() || width <= 0.0)
    {
        return Err("layout geometry must be finite and positive".to_owned());
    }
    Ok(())
}

fn project_layout(
    input: &FlowLayoutInput,
    layout: &parley::Layout<u32>,
    registered_assets: &HashMap<String, RegisteredAsset>,
) -> Result<FlowLayoutOutput, String> {
    let utf16_boundaries = utf16_boundaries(&input.text);
    let logical_bounds = OutputRect {
        x: input.origin_x,
        y: input.origin_y,
        width: layout.width(),
        height: layout.height(),
    };
    let mut output = FlowLayoutOutput {
        key: input.key.clone(),
        runs: Vec::new(),
        lines: Vec::new(),
        caret_stops: Vec::new(),
        selection_geometry: Vec::new(),
        cluster_map: Vec::new(),
        ink_bounds: OutputRect::default(),
        logical_bounds,
        grapheme_stops: GraphemeClusterSegmenter::new()
            .segment_str(&input.text)
            .map(|offset| byte_to_utf16_fast(&utf16_boundaries, offset))
            .collect::<Result<Vec<_>, _>>()?,
        glyph_count: 0,
    };
    let mut logical_clusters = Vec::new();
    let mut ink_extents: Option<(f32, f32, f32, f32)> = None;
    for line in layout.lines() {
        let metrics = line.metrics();
        let line_range = line.text_range();
        output.lines.push(OutputLine {
            start: byte_to_utf16_fast(&utf16_boundaries, line_range.start)?,
            end: byte_to_utf16_fast(&utf16_boundaries, line_range.end)?,
            baseline: input.origin_y + metrics.baseline,
            ascent: metrics.ascent,
            descent: metrics.descent,
            bounds: OutputRect {
                x: input.origin_x + metrics.inline_min_coord,
                y: input.origin_y + metrics.block_min_coord,
                width: metrics.inline_max_coord - metrics.inline_min_coord,
                height: metrics.block_max_coord - metrics.block_min_coord,
            },
        });
        let mut run_x = input.origin_x + metrics.inline_min_coord + metrics.offset;
        for run in line.runs() {
            if run.normalized_coords().iter().any(|coord| *coord != 0) || run.synthesis().any() {
                return Err(
                    "unsupported font instance: Parley selected variation coordinates or synthesis"
                        .to_owned(),
                );
            }
            let font_ref = FontRef::from_index(run.font().data.data(), run.font().index).ok();
            let normalized_coords: Vec<NormalizedCoord> = run
                .normalized_coords()
                .iter()
                .copied()
                .map(NormalizedCoord::from_bits)
                .collect();
            let glyph_metrics = font_ref.as_ref().map(|font| {
                font.glyph_metrics(
                    Size::new(run.font_size()),
                    LocationRef::new(&normalized_coords),
                )
            });
            let mut cluster_x = run_x;
            for cluster in run.visual_clusters() {
                let source_run_index = cluster.first_style().brush;
                let expected = input.styles.get(source_run_index as usize).ok_or_else(|| {
                    "Parley returned a source style index outside the request".to_owned()
                })?;
                let resolved_exact = registered_assets
                    .get(&expected.expected_asset_id)
                    .is_some_and(|asset| {
                        asset.blob_id == run.font().data.id()
                            && expected.expected_face_index == run.font().index
                    });
                let text_range = cluster.text_range();
                let text_start = byte_to_utf16_fast(&utf16_boundaries, text_range.start)?;
                let text_end = byte_to_utf16_fast(&utf16_boundaries, text_range.end)?;
                let mut glyph_ids = Vec::new();
                let mut geometry = Vec::new();
                for glyph in cluster.glyphs() {
                    if let Some(bounds) = glyph_metrics
                        .as_ref()
                        .and_then(|metrics| metrics.bounds(GlyphId::new(glyph.id)))
                    {
                        let x_min = cluster_x + glyph.x + bounds.x_min;
                        let x_max = cluster_x + glyph.x + bounds.x_max;
                        let y_min = input.origin_y + metrics.baseline + glyph.y - bounds.y_max;
                        let y_max = input.origin_y + metrics.baseline + glyph.y - bounds.y_min;
                        ink_extents = Some(match ink_extents {
                            Some((left, top, right, bottom)) => (
                                left.min(x_min),
                                top.min(y_min),
                                right.max(x_max),
                                bottom.max(y_max),
                            ),
                            None => (x_min, y_min, x_max, y_max),
                        });
                    }
                    glyph_ids.push(glyph.id);
                    geometry.extend_from_slice(&[
                        cluster_x + glyph.x,
                        input.origin_y + metrics.baseline + glyph.y,
                        glyph.advance,
                        0.0,
                    ]);
                }
                let bounds = OutputRect {
                    x: cluster_x,
                    y: input.origin_y + metrics.block_min_coord,
                    width: cluster.advance(),
                    height: metrics.line_height,
                };
                logical_clusters.push(LogicalCluster {
                    source_run_index,
                    direction: if run.is_rtl() { "rtl" } else { "ltr" },
                    resolved_exact,
                    text_start,
                    text_end,
                    bounds,
                    start_x: if run.is_rtl() {
                        cluster_x + cluster.advance()
                    } else {
                        cluster_x
                    },
                    end_x: if run.is_rtl() {
                        cluster_x
                    } else {
                        cluster_x + cluster.advance()
                    },
                    glyph_ids,
                    geometry,
                });
                cluster_x += cluster.advance();
            }
            run_x += run.advance();
        }
    }
    logical_clusters.sort_by_key(|cluster| (cluster.text_start, cluster.text_end));
    for cluster in logical_clusters {
        let glyph_start = output.glyph_count;
        output.glyph_count += cluster.glyph_ids.len();
        if output.glyph_count > input.max_glyph_count {
            return Err("layout exceeds maxGlyphCount".to_owned());
        }
        output.cluster_map.push(OutputCluster {
            text_start: cluster.text_start,
            text_end: cluster.text_end,
            glyph_start,
            glyph_end: output.glyph_count,
        });
        output.selection_geometry.push(OutputSelection {
            start: cluster.text_start,
            end: cluster.text_end,
            bounds: cluster.bounds,
        });
        if output
            .grapheme_stops
            .binary_search(&cluster.text_start)
            .is_ok()
        {
            output.caret_stops.push(OutputCaret {
                text_offset: cluster.text_start,
                x: cluster.start_x,
                y: cluster.bounds.y,
                height: cluster.bounds.height,
                affinity: "downstream",
            });
        }
        if output
            .grapheme_stops
            .binary_search(&cluster.text_end)
            .is_ok()
        {
            output.caret_stops.push(OutputCaret {
                text_offset: cluster.text_end,
                x: cluster.end_x,
                y: cluster.bounds.y,
                height: cluster.bounds.height,
                affinity: "upstream",
            });
        }
        if let Some(run) = output.runs.last_mut().filter(|run| {
            run.source_run_index == cluster.source_run_index
                && run.direction == cluster.direction
                && run.resolved_exact == cluster.resolved_exact
        }) {
            run.clusters.extend(std::iter::repeat_n(
                cluster.text_start as u32,
                cluster.glyph_ids.len(),
            ));
            run.glyph_ids.extend(cluster.glyph_ids);
            run.geometry.extend(cluster.geometry);
        } else {
            output.runs.push(OutputRun {
                source_run_index: cluster.source_run_index,
                direction: cluster.direction,
                resolved_exact: cluster.resolved_exact,
                clusters: vec![cluster.text_start as u32; cluster.glyph_ids.len()],
                glyph_ids: cluster.glyph_ids,
                geometry: cluster.geometry,
            });
        }
    }
    output
        .caret_stops
        .sort_by_key(|stop| (stop.text_offset, stop.affinity));
    output.caret_stops.dedup_by(|left, right| {
        left.text_offset == right.text_offset && left.affinity == right.affinity
    });
    if let Some((left, top, right, bottom)) = ink_extents {
        output.ink_bounds = OutputRect {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        };
    }
    Ok(output)
}

pub(crate) struct PackedFlowLayout {
    pub(crate) key: String,
    pub(crate) run_meta: Vec<u32>,
    pub(crate) glyph_ids: Vec<u32>,
    pub(crate) clusters: Vec<u32>,
    pub(crate) geometry: Vec<f32>,
    pub(crate) line_meta: Vec<u32>,
    pub(crate) line_geometry: Vec<f32>,
    pub(crate) caret_meta: Vec<u32>,
    pub(crate) caret_geometry: Vec<f32>,
    pub(crate) selection_meta: Vec<u32>,
    pub(crate) selection_geometry: Vec<f32>,
    pub(crate) cluster_map: Vec<u32>,
    pub(crate) bounds: Vec<f32>,
    pub(crate) grapheme_stops: Vec<u32>,
}

impl From<FlowLayoutOutput> for PackedFlowLayout {
    fn from(output: FlowLayoutOutput) -> Self {
        let mut packed = Self {
            key: output.key,
            run_meta: Vec::with_capacity(output.runs.len() * 5),
            glyph_ids: Vec::with_capacity(output.glyph_count),
            clusters: Vec::with_capacity(output.glyph_count),
            geometry: Vec::with_capacity(output.glyph_count * 4),
            line_meta: Vec::with_capacity(output.lines.len() * 2),
            line_geometry: Vec::with_capacity(output.lines.len() * 7),
            caret_meta: Vec::with_capacity(output.caret_stops.len() * 2),
            caret_geometry: Vec::with_capacity(output.caret_stops.len() * 3),
            selection_meta: Vec::with_capacity(output.selection_geometry.len() * 2),
            selection_geometry: Vec::with_capacity(output.selection_geometry.len() * 4),
            cluster_map: Vec::with_capacity(output.cluster_map.len() * 4),
            bounds: vec![
                output.ink_bounds.x,
                output.ink_bounds.y,
                output.ink_bounds.width,
                output.ink_bounds.height,
                output.logical_bounds.x,
                output.logical_bounds.y,
                output.logical_bounds.width,
                output.logical_bounds.height,
            ],
            grapheme_stops: output
                .grapheme_stops
                .into_iter()
                .map(|value| value as u32)
                .collect(),
        };
        for run in output.runs {
            let start = packed.glyph_ids.len() as u32;
            packed.glyph_ids.extend(run.glyph_ids);
            packed.clusters.extend(run.clusters);
            packed.geometry.extend(run.geometry);
            packed.run_meta.extend_from_slice(&[
                run.source_run_index,
                u32::from(run.direction == "rtl"),
                u32::from(run.resolved_exact),
                start,
                packed.glyph_ids.len() as u32,
            ]);
        }
        for line in output.lines {
            packed
                .line_meta
                .extend_from_slice(&[line.start as u32, line.end as u32]);
            packed.line_geometry.extend_from_slice(&[
                line.baseline,
                line.ascent,
                line.descent,
                line.bounds.x,
                line.bounds.y,
                line.bounds.width,
                line.bounds.height,
            ]);
        }
        for caret in output.caret_stops {
            packed.caret_meta.extend_from_slice(&[
                caret.text_offset as u32,
                u32::from(caret.affinity == "downstream"),
            ]);
            packed
                .caret_geometry
                .extend_from_slice(&[caret.x, caret.y, caret.height]);
        }
        for selection in output.selection_geometry {
            packed
                .selection_meta
                .extend_from_slice(&[selection.start as u32, selection.end as u32]);
            packed.selection_geometry.extend_from_slice(&[
                selection.bounds.x,
                selection.bounds.y,
                selection.bounds.width,
                selection.bounds.height,
            ]);
        }
        for cluster in output.cluster_map {
            packed.cluster_map.extend_from_slice(&[
                cluster.text_start as u32,
                cluster.text_end as u32,
                cluster.glyph_start as u32,
                cluster.glyph_end as u32,
            ]);
        }
        packed
    }
}
