use read_fonts::{FontRef, TableProvider};
use serde::Serialize;
use skrifa::{
    MetadataProvider,
    instance::{LocationRef, Size},
};
use wasm_bindgen::prelude::*;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FontInspection {
    glyph_count: u16,
    units_per_em: u16,
    axis_count: usize,
    outline: &'static str,
    embedding_level: &'static str,
    no_subsetting: bool,
    bitmap_only: bool,
}

fn embedding(fs_type: u16) -> (&'static str, bool, bool) {
    let level = if fs_type & 0x0002 != 0 {
        "restricted"
    } else if fs_type & 0x0008 != 0 {
        "editable"
    } else if fs_type & 0x0004 != 0 {
        "preview-print"
    } else {
        "installable"
    };
    (level, fs_type & 0x0100 != 0, fs_type & 0x0200 != 0)
}

fn inspect_font(data: &[u8], face_index: u32) -> Result<FontInspection, String> {
    if data.len() > 64 * 1024 * 1024 {
        return Err("font exceeds the 64 MiB inspection limit".to_owned());
    }
    let font = FontRef::from_index(data, face_index)
        .map_err(|error| format!("invalid OpenType font or face index: {error}"))?;
    let maxp_glyph_count = font
        .maxp()
        .map_err(|error| format!("invalid maxp table: {error}"))?
        .num_glyphs();
    font.head()
        .map_err(|error| format!("invalid head table: {error}"))?;
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let glyph_count = metrics.glyph_count;
    if glyph_count != maxp_glyph_count {
        return Err("font metric glyph count is inconsistent".to_owned());
    }
    if glyph_count == 0 {
        return Err("font contains no glyphs".to_owned());
    }
    let units_per_em = metrics.units_per_em;
    let axis_count = font.axes().len();
    let outline = if font.glyf().is_ok() {
        "truetype"
    } else if font.cff2().is_ok() {
        "cff2"
    } else if font.cff().is_ok() {
        "cff"
    } else {
        "unknown"
    };
    let fs_type = font.os2().map(|table| table.fs_type()).unwrap_or(0);
    let (embedding_level, no_subsetting, bitmap_only) = embedding(fs_type);
    Ok(FontInspection {
        glyph_count,
        units_per_em,
        axis_count,
        outline,
        embedding_level,
        no_subsetting,
        bitmap_only,
    })
}

/// Smoke-test API for the cross-host text engine boundary.
///
/// Layout and font APIs are added only after their serializable contracts are
/// frozen in Slice 02. Keeping this export deliberately small prevents the
/// toolchain spike from becoming an accidental production ABI.
#[wasm_bindgen]
pub fn text_engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// Memory-safe OpenType metadata inspection for the browser/Electron worker.
#[wasm_bindgen]
pub fn inspect_font_json(data: &[u8], face_index: u32) -> Result<String, JsValue> {
    let inspection = inspect_font(data, face_index).map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(&inspection).map_err(|error| {
        JsValue::from_str(&format!("font inspection serialization failed: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_crate_version() {
        assert_eq!(text_engine_version(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn maps_opentype_embedding_flags() {
        assert_eq!(embedding(0), ("installable", false, false));
        assert_eq!(embedding(0x0104), ("preview-print", true, false));
        assert_eq!(embedding(0x0208), ("editable", false, true));
        assert_eq!(embedding(0x0002), ("restricted", false, false));
    }

    #[test]
    fn rejects_truncated_and_out_of_range_fonts() {
        assert!(
            inspect_font(&[0, 1, 0, 0], 0)
                .unwrap_err()
                .contains("invalid OpenType")
        );
    }

    #[test]
    fn inspects_licensed_truetype_cff_and_variable_fixtures() {
        let truetype = inspect_font(
            include_bytes!("../../../test/fixtures/fonts/Anton-Regular.ttf"),
            0,
        )
        .unwrap();
        assert_eq!(truetype.outline, "truetype");
        assert!(truetype.glyph_count > 100);
        assert_eq!(truetype.axis_count, 0);

        let cff = inspect_font(
            include_bytes!("../../../test/fixtures/fonts/SourceSerif4-Regular.otf"),
            0,
        )
        .unwrap();
        assert_eq!(cff.outline, "cff");
        assert!(cff.glyph_count > 100);

        let variable = inspect_font(
            include_bytes!("../../../test/fixtures/fonts/RobotoFlex-Variable.ttf"),
            0,
        )
        .unwrap();
        assert_eq!(variable.outline, "truetype");
        assert!(variable.axis_count > 1);
        assert!(
            inspect_font(
                include_bytes!("../../../test/fixtures/fonts/RobotoFlex-Variable.ttf"),
                1
            )
            .is_err()
        );
    }
}
