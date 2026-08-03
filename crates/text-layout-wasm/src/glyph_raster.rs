use skrifa::{
    FontRef, MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, HintingInstance, HintingOptions, OutlinePen},
    raw::types::GlyphId,
};
use zeno::{Command, Mask, PathBuilder, Point};

const MIN_PPEM: f32 = 4.0;
const MAX_PPEM: f32 = 256.0;
const MAX_COMMANDS: usize = 32_768;
const MAX_DIMENSION: u32 = 256;
const MAX_MASK_BYTES: usize = 65_536;

#[derive(Default)]
struct ZenoPen {
    commands: Vec<Command>,
    overflowed: bool,
}

impl ZenoPen {
    fn push(&mut self, command: impl FnOnce(&mut Vec<Command>)) {
        if self.commands.len() >= MAX_COMMANDS {
            self.overflowed = true;
        } else {
            command(&mut self.commands);
        }
    }
}

impl OutlinePen for ZenoPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.push(|commands| {
            commands.move_to(Point::new(x, -y));
        });
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.push(|commands| {
            commands.line_to(Point::new(x, -y));
        });
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.push(|commands| {
            commands.quad_to(Point::new(cx0, -cy0), Point::new(x, -y));
        });
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.push(|commands| {
            commands.curve_to(
                Point::new(cx0, -cy0),
                Point::new(cx1, -cy1),
                Point::new(x, -y),
            );
        });
    }

    fn close(&mut self) {
        self.push(|commands| {
            commands.close();
        });
    }
}

pub(crate) struct GlyphCoverageMask {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) bearing_x: i32,
    pub(crate) bearing_y: i32,
    pub(crate) pixels: Vec<u8>,
    pub(crate) command_count: usize,
}

pub(crate) fn rasterize(
    bytes: &[u8],
    face_index: u32,
    glyph_id: u32,
    ppem: f32,
) -> Result<GlyphCoverageMask, String> {
    if !ppem.is_finite() || !(MIN_PPEM..=MAX_PPEM).contains(&ppem) {
        return Err(format!("glyph ppem must be in [{MIN_PPEM}, {MAX_PPEM}]"));
    }
    if glyph_id > u16::MAX as u32 {
        return Err("glyph identifier exceeds OpenType glyph range".to_owned());
    }
    let font = FontRef::from_index(bytes, face_index)
        .map_err(|error| format!("invalid registered font face: {error}"))?;
    let outlines = font.outline_glyphs();
    let glyph = outlines
        .get(GlyphId::new(glyph_id))
        .ok_or_else(|| "glyph has no scalable outline".to_owned())?;
    let hinting = HintingInstance::new(
        &outlines,
        Size::new(ppem),
        LocationRef::default(),
        HintingOptions::default(),
    )
    .map_err(|error| format!("glyph hinting setup failed: {error}"))?;
    let mut pen = ZenoPen::default();
    glyph
        .draw(DrawSettings::hinted(&hinting, true), &mut pen)
        .map_err(|error| format!("hinted glyph outline failed: {error}"))?;
    if pen.overflowed {
        return Err(format!(
            "glyph outline exceeds the {MAX_COMMANDS}-command limit"
        ));
    }
    let command_count = pen.commands.len();
    let mut mask = Mask::new(&pen.commands);
    let mut dimensions = (0, 0);
    mask.inspect(|_, width, height| dimensions = (width, height));
    if dimensions.0 > MAX_DIMENSION || dimensions.1 > MAX_DIMENSION {
        return Err(format!(
            "glyph mask exceeds the {MAX_DIMENSION}-pixel dimension limit"
        ));
    }
    let byte_length = (dimensions.0 as usize)
        .checked_mul(dimensions.1 as usize)
        .ok_or_else(|| "glyph mask dimensions overflow".to_owned())?;
    if byte_length > MAX_MASK_BYTES {
        return Err(format!(
            "glyph mask exceeds the {MAX_MASK_BYTES}-byte limit"
        ));
    }
    let mut pixels = vec![0; byte_length];
    let placement = mask.render_into(&mut pixels, None);
    Ok(GlyphCoverageMask {
        width: placement.width,
        height: placement.height,
        bearing_x: placement.left,
        bearing_y: -placement.top,
        pixels,
        command_count,
    })
}
