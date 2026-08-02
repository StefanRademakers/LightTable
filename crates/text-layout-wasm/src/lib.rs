use read_fonts::{FontRef, TableProvider};
use serde::Serialize;
use skrifa::{
    MetadataProvider,
    instance::{LocationRef, Size},
};
use wasm_bindgen::prelude::*;

mod layout;

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

/// Registers immutable font bytes in one document-generation layout context.
#[wasm_bindgen]
pub fn register_layout_font(
    session_key: &str,
    asset_id: &str,
    data: &[u8],
) -> Result<u32, JsValue> {
    inspect_font(data, 0).map_err(|error| JsValue::from_str(&error))?;
    layout::register_font(session_key, asset_id, data)
        .map(|count| count as u32)
        .map_err(|error| JsValue::from_str(&error))
}

/// Packed, allocation-bounded layout result. Numeric getters become JavaScript
/// typed arrays and avoid JSON/string copies across the WASM boundary.
#[wasm_bindgen]
pub struct PackedFlowLayout(layout::PackedFlowLayout);

#[wasm_bindgen]
impl PackedFlowLayout {
    #[wasm_bindgen(getter)]
    pub fn key(&self) -> String {
        self.0.key.clone()
    }
    pub fn run_meta(&self) -> Vec<u32> {
        self.0.run_meta.clone()
    }
    pub fn glyph_ids(&self) -> Vec<u32> {
        self.0.glyph_ids.clone()
    }
    pub fn clusters(&self) -> Vec<u32> {
        self.0.clusters.clone()
    }
    pub fn geometry(&self) -> Vec<f32> {
        self.0.geometry.clone()
    }
    pub fn line_meta(&self) -> Vec<u32> {
        self.0.line_meta.clone()
    }
    pub fn line_geometry(&self) -> Vec<f32> {
        self.0.line_geometry.clone()
    }
    pub fn caret_meta(&self) -> Vec<u32> {
        self.0.caret_meta.clone()
    }
    pub fn caret_geometry(&self) -> Vec<f32> {
        self.0.caret_geometry.clone()
    }
    pub fn selection_meta(&self) -> Vec<u32> {
        self.0.selection_meta.clone()
    }
    pub fn selection_geometry(&self) -> Vec<f32> {
        self.0.selection_geometry.clone()
    }
    pub fn cluster_map(&self) -> Vec<u32> {
        self.0.cluster_map.clone()
    }
    pub fn bounds(&self) -> Vec<f32> {
        self.0.bounds.clone()
    }
    pub fn grapheme_stops(&self) -> Vec<u32> {
        self.0.grapheme_stops.clone()
    }
}

/// Shapes one validated flow-text request through the persistent Parley stack.
/// Style metadata uses fixed strides: u32 = start/end/source/style/face and
/// f32 = size/weight/stretch/tracking. String ranges address paired family and
/// expected font-asset identities in one UTF-8 byte table.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn realize_flow_text(
    session_key: &str,
    key: &str,
    text: &str,
    max_width: Option<f32>,
    origin_x: f32,
    origin_y: f32,
    max_glyph_count: u32,
    style_meta: &[u32],
    style_metrics: &[f32],
    font_strings_utf8: &[u8],
    string_ranges: &[u32],
) -> Result<PackedFlowLayout, JsValue> {
    if style_meta.len() % 5 != 0
        || style_metrics.len() != style_meta.len() / 5 * 4
        || string_ranges.len() != style_meta.len() / 5 * 4
    {
        return Err(JsValue::from_str(
            "packed style arrays have inconsistent strides",
        ));
    }
    let mut styles = Vec::with_capacity(style_meta.len() / 5);
    for index in 0..style_meta.len() / 5 {
        let meta = &style_meta[index * 5..index * 5 + 5];
        let metrics = &style_metrics[index * 4..index * 4 + 4];
        let ranges = &string_ranges[index * 4..index * 4 + 4];
        let family_range = &ranges[0..2];
        let family_start = family_range[0] as usize;
        let family_end = family_range[1] as usize;
        let family = std::str::from_utf8(
            font_strings_utf8
                .get(family_start..family_end)
                .ok_or_else(|| JsValue::from_str("font family range is out of bounds"))?,
        )
        .map_err(|_| JsValue::from_str("font family is not valid UTF-8"))?;
        let asset_start = ranges[2] as usize;
        let asset_end = ranges[3] as usize;
        let expected_asset_id = std::str::from_utf8(
            font_strings_utf8
                .get(asset_start..asset_end)
                .ok_or_else(|| JsValue::from_str("font asset range is out of bounds"))?,
        )
        .map_err(|_| JsValue::from_str("font asset identity is not valid UTF-8"))?;
        let font_style = match meta[3] {
            0 => parley::FontStyle::Normal,
            1 => parley::FontStyle::Italic,
            2 => parley::FontStyle::Oblique(Some(14.0)),
            _ => return Err(JsValue::from_str("packed font style is invalid")),
        };
        styles.push(layout::FlowStyleInput {
            start: meta[0] as usize,
            end: meta[1] as usize,
            source_run_index: meta[2],
            expected_face_index: meta[4],
            expected_asset_id: expected_asset_id.to_owned(),
            font_style,
            family: family.to_owned(),
            font_size: metrics[0],
            font_weight: metrics[1],
            font_stretch: metrics[2],
            tracking: metrics[3],
        });
    }
    layout::realize_flow(
        session_key,
        layout::FlowLayoutInput {
            key: key.to_owned(),
            text: text.to_owned(),
            styles,
            max_width,
            origin_x,
            origin_y,
            max_glyph_count: max_glyph_count as usize,
        },
    )
    .map(|output| PackedFlowLayout(output.into()))
    .map_err(|error| JsValue::from_str(&error))
}

/// Current reserved WASM linear memory, for bounded diagnostics only.
#[wasm_bindgen]
pub fn text_engine_memory_bytes() -> u32 {
    #[cfg(target_arch = "wasm32")]
    {
        (core::arch::wasm32::memory_size(0) * 65_536) as u32
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        0
    }
}

/// Releases all parsed fonts and scratch allocations for one generation.
#[wasm_bindgen]
pub fn drop_layout_session(session_key: &str) -> bool {
    layout::drop_session(session_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape_fixture(
        session: &str,
        asset: &str,
        bytes: &[u8],
        family: &str,
        text: &str,
    ) -> PackedFlowLayout {
        inspect_font(bytes, 0).unwrap();
        assert_eq!(
            layout::register_font(session, asset, bytes)
                .unwrap_or_else(|error| panic!("{session}: {error}")),
            1
        );
        PackedFlowLayout(
            layout::realize_flow(
                session,
                layout::FlowLayoutInput {
                    key: session.to_owned(),
                    text: text.to_owned(),
                    styles: vec![layout::FlowStyleInput {
                        start: 0,
                        end: text.encode_utf16().count(),
                        family: family.to_owned(),
                        font_size: 24.0,
                        font_weight: 400.0,
                        font_stretch: 100.0,
                        font_style: parley::FontStyle::Normal,
                        tracking: 0.0,
                        source_run_index: 0,
                        expected_asset_id: asset.to_owned(),
                        expected_face_index: 0,
                    }],
                    max_width: Some(320.0),
                    origin_x: 0.25,
                    origin_y: 0.5,
                    max_glyph_count: 1_000,
                },
            )
            .unwrap()
            .into(),
        )
    }

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

    #[test]
    fn shapes_latin_with_parley_and_emits_utf16_geometry() {
        let session = "test:1";
        let bytes = include_bytes!("../../../test/fixtures/fonts/Anton-Regular.ttf");
        assert_eq!(register_layout_font(session, "anton", bytes).unwrap(), 1);
        let output = realize_flow_text(
            session,
            "golden-latin",
            "office A😀",
            Some(400.0),
            5.0,
            7.0,
            100,
            &[0, 10, 0, 0, 0],
            &[24.0, 400.0, 100.0, 0.0],
            b"Antonanton",
            &[0, 5, 5, 10],
        )
        .unwrap();
        assert_eq!(output.key(), "golden-latin");
        assert!(!output.glyph_ids().is_empty());
        assert_eq!(output.grapheme_stops().last(), Some(&10));
        assert!(output.bounds()[2] > 0.0);
        assert_ne!(&output.bounds()[0..4], &output.bounds()[4..8]);
        assert!(drop_layout_session(session));
    }

    #[test]
    fn shapes_the_complex_script_corpus_with_exact_font_provenance() {
        let fixtures: &[(&str, &str, &[u8], &str, &str)] = &[
            (
                "arabic",
                "arabic",
                include_bytes!("../../../test/fixtures/fonts/NotoKufiArabic-Slice06.otf"),
                "Noto Kufi Arabic",
                "مرحبا",
            ),
            (
                "hebrew",
                "hebrew",
                include_bytes!("../../../test/fixtures/fonts/NotoSansHebrew-Slice06.ttf"),
                "Noto Sans Hebrew",
                "שלום",
            ),
            (
                "devanagari",
                "devanagari",
                include_bytes!("../../../test/fixtures/fonts/NotoSansDevanagari-Slice06.ttf"),
                "Noto Sans Devanagari",
                "नमस्ते",
            ),
            (
                "thai",
                "thai",
                include_bytes!("../../../test/fixtures/fonts/NotoSansThai-Slice06.ttf"),
                "Noto Sans Thai",
                "ภาษาไทย",
            ),
            (
                "cjk",
                "cjk",
                include_bytes!("../../../test/fixtures/fonts/NotoSansCJKjp-Slice06.otf"),
                "Noto Sans CJK JP",
                "日本語中文",
            ),
            (
                "emoji",
                "emoji",
                include_bytes!("../../../test/fixtures/fonts/NotoEmoji-Slice06.ttf"),
                "Noto Emoji",
                "😀",
            ),
        ];
        for (session, asset, bytes, family, text) in fixtures {
            let output = shape_fixture(session, asset, bytes, family, text);
            assert!(!output.glyph_ids().is_empty(), "{session}");
            assert_eq!(
                output.grapheme_stops().last().copied(),
                Some(text.encode_utf16().count() as u32),
                "{session}"
            );
            assert!(
                output.run_meta().chunks_exact(5).all(|run| run[2] == 1),
                "{session}"
            );
            assert!(drop_layout_session(session));
        }
    }

    #[test]
    fn preserves_combining_clusters_and_mixed_bidi_visual_geometry() {
        let combining = shape_fixture(
            "combining",
            "source-serif",
            include_bytes!("../../../test/fixtures/fonts/SourceSerif4-Regular.otf"),
            "Source Serif 4",
            "A\u{301}",
        );
        assert!(!combining.cluster_map().is_empty());
        assert_eq!(combining.grapheme_stops(), vec![0, 2]);
        assert!(drop_layout_session("combining"));

        let session = "mixed-bidi";
        layout::register_font(
            session,
            "anton",
            include_bytes!("../../../test/fixtures/fonts/Anton-Regular.ttf"),
        )
        .unwrap();
        layout::register_font(
            session,
            "hebrew",
            include_bytes!("../../../test/fixtures/fonts/NotoSansHebrew-Slice06.ttf"),
        )
        .unwrap();
        let strings = b"AntonantonNoto Sans Hebrewhebrew";
        let output = realize_flow_text(
            session,
            session,
            "ABC שלום",
            Some(200.0),
            0.0,
            0.0,
            100,
            &[0, 4, 0, 0, 0, 4, 8, 1, 0, 0],
            &[20.0, 400.0, 100.0, 0.0, 20.0, 400.0, 100.0, 0.0],
            strings,
            &[0, 5, 5, 10, 10, 26, 26, 32],
        )
        .unwrap();
        let directions: Vec<u32> = output
            .run_meta()
            .chunks_exact(5)
            .map(|run| run[1])
            .collect();
        assert!(directions.contains(&0) && directions.contains(&1));
        assert!(
            output
                .cluster_map()
                .chunks_exact(4)
                .is_sorted_by_key(|entry| entry[0])
        );
        assert!(drop_layout_session(session));
    }

    #[test]
    fn resolves_exact_font_provenance_per_source_cluster() {
        let session = "cluster-provenance";
        layout::register_font(
            session,
            "anton",
            include_bytes!("../../../test/fixtures/fonts/Anton-Regular.ttf"),
        )
        .unwrap();
        layout::register_font(
            session,
            "source-serif",
            include_bytes!("../../../test/fixtures/fonts/SourceSerif4-Regular.otf"),
        )
        .unwrap();
        let output = PackedFlowLayout(
            layout::realize_flow(
                session,
                layout::FlowLayoutInput {
                    key: session.to_owned(),
                    text: "AB".to_owned(),
                    styles: vec![
                        layout::FlowStyleInput {
                            start: 0,
                            end: 1,
                            family: "Anton".to_owned(),
                            font_size: 24.0,
                            font_weight: 400.0,
                            font_stretch: 100.0,
                            font_style: parley::FontStyle::Normal,
                            tracking: 0.0,
                            source_run_index: 0,
                            expected_asset_id: "anton".to_owned(),
                            expected_face_index: 0,
                        },
                        layout::FlowStyleInput {
                            start: 1,
                            end: 2,
                            family: "Anton".to_owned(),
                            font_size: 24.0,
                            font_weight: 400.0,
                            font_stretch: 100.0,
                            font_style: parley::FontStyle::Normal,
                            tracking: 0.0,
                            source_run_index: 1,
                            expected_asset_id: "source-serif".to_owned(),
                            expected_face_index: 0,
                        },
                    ],
                    max_width: None,
                    origin_x: 0.0,
                    origin_y: 0.0,
                    max_glyph_count: 10,
                },
            )
            .unwrap()
            .into(),
        );
        let provenance: Vec<u32> = output
            .run_meta()
            .chunks_exact(5)
            .map(|run| run[2])
            .collect();
        assert_eq!(provenance, vec![1, 0]);
        assert!(drop_layout_session(session));
    }

    #[test]
    fn rejects_unreported_variable_font_instances() {
        let session = "variable-instance";
        layout::register_font(
            session,
            "roboto-flex",
            include_bytes!("../../../test/fixtures/fonts/RobotoFlex-Variable.ttf"),
        )
        .unwrap();
        let result = layout::realize_flow(
            session,
            layout::FlowLayoutInput {
                key: session.to_owned(),
                text: "A".to_owned(),
                styles: vec![layout::FlowStyleInput {
                    start: 0,
                    end: 1,
                    family: "Roboto Flex".to_owned(),
                    font_size: 24.0,
                    font_weight: 700.0,
                    font_stretch: 100.0,
                    font_style: parley::FontStyle::Normal,
                    tracking: 0.0,
                    source_run_index: 0,
                    expected_asset_id: "roboto-flex".to_owned(),
                    expected_face_index: 0,
                }],
                max_width: None,
                origin_x: 0.0,
                origin_y: 0.0,
                max_glyph_count: 10,
            },
        );
        let error = match result {
            Ok(_) => panic!("variable font instance should be rejected"),
            Err(error) => error,
        };
        assert!(error.contains("unsupported font instance"), "{error}");
        assert!(drop_layout_session(session));
    }
}
