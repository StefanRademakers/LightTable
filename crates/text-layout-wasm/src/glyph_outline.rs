use skrifa::{
    FontRef, MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
    raw::types::GlyphId,
};
use std::collections::HashSet;

const MAX_VARIATION_AXES: usize = 64;
const MAX_COMMANDS: usize = 32_768;
const MAX_COORDINATES: usize = MAX_COMMANDS * 6;

const MOVE_TO: u8 = 0;
const LINE_TO: u8 = 1;
const QUAD_TO: u8 = 2;
const CURVE_TO: u8 = 3;
const CLOSE: u8 = 4;

#[derive(Default)]
struct PackedOutlinePen {
    verbs: Vec<u8>,
    coordinates: Vec<f32>,
    bounds: Option<[f32; 4]>,
    overflowed: bool,
    invalid: bool,
}

impl PackedOutlinePen {
    fn push(&mut self, verb: u8, coordinates: &[f32]) {
        if self.verbs.len() >= MAX_COMMANDS
            || self.coordinates.len().saturating_add(coordinates.len()) > MAX_COORDINATES
        {
            self.overflowed = true;
            return;
        }
        if !coordinates.iter().all(|value| value.is_finite()) {
            self.invalid = true;
            return;
        }
        self.verbs.push(verb);
        self.coordinates.extend_from_slice(coordinates);
        for point in coordinates.chunks_exact(2) {
            let [x, y] = [point[0], point[1]];
            match &mut self.bounds {
                Some([min_x, min_y, max_x, max_y]) => {
                    *min_x = min_x.min(x);
                    *min_y = min_y.min(y);
                    *max_x = max_x.max(x);
                    *max_y = max_y.max(y);
                }
                bounds @ None => *bounds = Some([x, y, x, y]),
            }
        }
    }
}

impl OutlinePen for PackedOutlinePen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.push(MOVE_TO, &[x, y]);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.push(LINE_TO, &[x, y]);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.push(QUAD_TO, &[cx0, cy0, x, y]);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.push(CURVE_TO, &[cx0, cy0, cx1, cy1, x, y]);
    }

    fn close(&mut self) {
        self.push(CLOSE, &[]);
    }
}

pub(crate) struct GlyphOutline {
    pub(crate) units_per_em: u16,
    pub(crate) verbs: Vec<u8>,
    pub(crate) coordinates: Vec<f32>,
    pub(crate) bounds: [f32; 4],
}

pub(crate) fn extract(
    bytes: &[u8],
    face_index: u32,
    glyph_id: u32,
    variations: &[(String, f32)],
) -> Result<GlyphOutline, String> {
    if glyph_id > u16::MAX as u32 {
        return Err("glyph identifier exceeds OpenType glyph range".to_owned());
    }
    if variations.len() > MAX_VARIATION_AXES {
        return Err(format!(
            "glyph outline exceeds the {MAX_VARIATION_AXES}-axis limit"
        ));
    }
    let mut tags = HashSet::with_capacity(variations.len());
    for (tag, value) in variations {
        if tag.len() != 4 || !tag.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
            return Err("variation tags must contain four printable ASCII characters".to_owned());
        }
        if !value.is_finite() {
            return Err("variation values must be finite".to_owned());
        }
        if !tags.insert(tag.as_str()) {
            return Err(format!("duplicate variation tag {tag}"));
        }
    }
    let font = FontRef::from_index(bytes, face_index)
        .map_err(|error| format!("invalid registered font face: {error}"))?;
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let outlines = font.outline_glyphs();
    let glyph = outlines
        .get(GlyphId::new(glyph_id))
        .ok_or_else(|| "glyph has no scalable outline".to_owned())?;
    let location = font
        .axes()
        .location(variations.iter().map(|(tag, value)| (tag.as_str(), *value)));
    let mut pen = PackedOutlinePen::default();
    glyph
        .draw(
            DrawSettings::unhinted(Size::unscaled(), &location),
            &mut pen,
        )
        .map_err(|error| format!("unscaled glyph outline failed: {error}"))?;
    if pen.overflowed {
        return Err(format!(
            "glyph outline exceeds the {MAX_COMMANDS}-command limit"
        ));
    }
    if pen.invalid {
        return Err("glyph outline emitted a non-finite coordinate".to_owned());
    }
    Ok(GlyphOutline {
        units_per_em: metrics.units_per_em,
        verbs: pen.verbs,
        coordinates: pen.coordinates,
        bounds: pen.bounds.unwrap_or([0.0; 4]),
    })
}
