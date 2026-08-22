use serde::Serialize;
use wasm_bindgen::prelude::*;

const NORMALIZER_VERSION: &str = "usvg-0.48.1-lighttable-1";
const ACTIVE_ELEMENTS: &[&str] = &[
    "script", "foreignObject", "iframe", "object", "embed", "audio", "video",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedSvg {
    svg: String,
    input_bytes: usize,
    output_bytes: usize,
    element_count: usize,
    max_depth: usize,
    normalizer_version: &'static str,
}

fn local_fragment_reference(value: &str) -> bool {
    let value = value.trim();
    value.is_empty() || (value.starts_with('#') && value.len() > 1)
}

fn validate_url_functions(value: &str) -> Result<(), String> {
    let mut remainder = value;
    while let Some(index) = remainder.to_ascii_lowercase().find("url(") {
        remainder = &remainder[index + 4..];
        let Some(end) = remainder.find(')') else {
            return Err("Malformed SVG url() reference.".to_owned());
        };
        let target = remainder[..end].trim().trim_matches(['\'', '"']);
        if !local_fragment_reference(target) {
            return Err("External SVG resource references are forbidden.".to_owned());
        }
        remainder = &remainder[end + 1..];
    }
    Ok(())
}

fn preflight(
    source: &str,
    max_elements: usize,
    max_depth: usize,
) -> Result<(roxmltree::Document<'_>, usize, usize), String> {
    if source.as_bytes().windows(9).any(|window| window.eq_ignore_ascii_case(b"<!doctype")) {
        return Err("SVG document type declarations are forbidden.".to_owned());
    }
    let document = roxmltree::Document::parse(source)
        .map_err(|value| format!("Invalid or unsafe SVG XML: {value}"))?;
    let mut elements = 0usize;
    let mut observed_depth = 0usize;

    if document.descendants().any(|node| node.is_pi()) {
        return Err("SVG processing instructions are forbidden.".to_owned());
    }

    for node in document.descendants().filter(|node| node.is_element()) {
        elements += 1;
        if elements > max_elements {
            return Err("SVG exceeds the configured element limit.".to_owned());
        }
        let depth = node.ancestors().filter(|ancestor| ancestor.is_element()).count();
        observed_depth = observed_depth.max(depth);
        if depth > max_depth {
            return Err("SVG exceeds the configured nesting-depth limit.".to_owned());
        }

        let name = node.tag_name().name();
        if ACTIVE_ELEMENTS.iter().any(|active| name.eq_ignore_ascii_case(active)) {
            return Err(format!("Active SVG element <{name}> is forbidden."));
        }
        if name.eq_ignore_ascii_case("style") {
            let css = node.text().unwrap_or_default();
            if css.to_ascii_lowercase().contains("@import") {
                return Err("SVG CSS imports are forbidden.".to_owned());
            }
            validate_url_functions(css)?;
        }
        for attribute in node.attributes() {
            let attribute_name = attribute.name();
            let value = attribute.value();
            if attribute_name.len() > 2 && attribute_name[..2].eq_ignore_ascii_case("on") {
                return Err(format!("SVG event attribute {attribute_name} is forbidden."));
            }
            if !name.eq_ignore_ascii_case("a")
                && attribute_name.eq_ignore_ascii_case("href")
                && !local_fragment_reference(value)
            {
                return Err("External and embedded SVG href resources are forbidden.".to_owned());
            }
            validate_url_functions(value)?;
        }
    }

    Ok((document, elements, observed_depth))
}

#[wasm_bindgen]
pub fn normalizer_version() -> String {
    NORMALIZER_VERSION.to_owned()
}

#[wasm_bindgen]
pub fn normalize_svg(
    source: &str,
    max_input_bytes: usize,
    max_output_bytes: usize,
    max_elements: usize,
    max_depth: usize,
) -> Result<String, JsValue> {
    normalize_svg_inner(
        source,
        max_input_bytes,
        max_output_bytes,
        max_elements,
        max_depth,
    )
    .map_err(|message| JsValue::from_str(&message))
}

fn normalize_svg_inner(
    source: &str,
    max_input_bytes: usize,
    max_output_bytes: usize,
    max_elements: usize,
    max_depth: usize,
) -> Result<String, String> {
    if source.len() > max_input_bytes {
        return Err("SVG exceeds the configured input-size limit.".to_owned());
    }
    let (document, element_count, observed_depth) = preflight(source, max_elements, max_depth)?;

    let mut options = usvg::Options::default();
    options.resources_dir = None;
    options.style_sheet = None;
    options.image_href_resolver = usvg::ImageHrefResolver {
        resolve_data: Box::new(|_, _, _| None),
        resolve_string: Box::new(|_, _| None),
    };
    let tree = usvg::Tree::from_xmltree(&document, &options)
        .map_err(|value| format!("SVG normalization failed: {value}"))?;
    let svg = tree.to_string(&usvg::WriteOptions {
        preserve_text: true,
        ..Default::default()
    });
    if svg.len() > max_output_bytes {
        return Err("Normalized SVG exceeds the configured output-size limit.".to_owned());
    }

    serde_json::to_string(&NormalizedSvg {
        input_bytes: source.len(),
        output_bytes: svg.len(),
        svg,
        element_count,
        max_depth: observed_depth,
        normalizer_version: NORMALIZER_VERSION,
    })
    .map_err(|value| format!("Could not encode normalization result: {value}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_references_and_shapes() {
        let source = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><defs><path id="p" d="M0 0h5v5z"/></defs><use href="#p" x="4"/><circle cx="10" cy="10" r="2"/></svg>"##;
        let value = normalize_svg_inner(source, 4096, 8192, 100, 32).unwrap();
        let result: serde_json::Value = serde_json::from_str(&value).unwrap();
        let svg = result["svg"].as_str().unwrap();
        assert!(!svg.contains("<use"));
        assert!(svg.matches("<path").count() >= 2);
    }

    #[test]
    fn preserves_local_clip_paths_as_normalized_geometry() {
        let source = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><defs><circle id="c" cx="5" cy="5" r="4"/><clipPath id="clip"><use href="#c"/></clipPath></defs><rect width="20" height="20" clip-path="url(#clip)"/></svg>"##;
        let value = normalize_svg_inner(source, 4096, 8192, 100, 32).unwrap();
        let result: serde_json::Value = serde_json::from_str(&value).unwrap();
        let svg = result["svg"].as_str().unwrap();
        assert!(svg.contains("clip-path=\"url(#clip)\""));
        assert!(svg.contains("<clipPath id=\"clip\""));
        assert!(!svg.contains("<use"));

        let object_box = r##"<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="box" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".4"/></clipPath></defs><rect x="10" y="20" width="100" height="50" clip-path="url(#box)"/></svg>"##;
        let value = normalize_svg_inner(object_box, 4096, 8192, 100, 32).unwrap();
        let result: serde_json::Value = serde_json::from_str(&value).unwrap();
        let svg = result["svg"].as_str().unwrap();
        assert!(svg.contains("<clipPath id=\"box\" transform=\"matrix(100 0 0 50 10 20)\""));
        assert!(!svg.contains("clipPathUnits="));
    }

    #[test]
    fn rejects_external_resources_and_active_content() {
        let external = r#"<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///secret.png"/></svg>"#;
        assert!(normalize_svg_inner(external, 4096, 8192, 100, 32).is_err());
        let script = r#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#;
        assert!(normalize_svg_inner(script, 4096, 8192, 100, 32).is_err());
        let css = r#"<svg xmlns="http://www.w3.org/2000/svg"><style>.x { fill: URL(https://example.com/a.svg#p) }</style></svg>"#;
        assert!(normalize_svg_inner(css, 4096, 8192, 100, 32).is_err());
        let dtd = r#"<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>"#;
        assert!(normalize_svg_inner(dtd, 4096, 8192, 100, 32).is_err());
    }

    #[test]
    fn flattens_external_hyperlinks_without_loading_them() {
        let link = r#"<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><path d="M0 0h5v5z"/></a></svg>"#;
        let value = normalize_svg_inner(link, 4096, 8192, 100, 32).unwrap();
        let result: serde_json::Value = serde_json::from_str(&value).unwrap();
        let svg = result["svg"].as_str().unwrap();
        assert!(!svg.contains("https://example.com"));
        assert!(svg.contains("<path"));
    }

    #[test]
    fn enforces_structural_budgets() {
        let nested = r#"<svg xmlns="http://www.w3.org/2000/svg"><g><g><path d="M0 0"/></g></g></svg>"#;
        assert!(normalize_svg_inner(nested, 4096, 8192, 100, 2).is_err());
        assert!(normalize_svg_inner(nested, 4096, 8192, 2, 32).is_err());
    }
}
