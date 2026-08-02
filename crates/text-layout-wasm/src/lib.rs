use wasm_bindgen::prelude::*;

/// Smoke-test API for the cross-host text engine boundary.
///
/// Layout and font APIs are added only after their serializable contracts are
/// frozen in Slice 02. Keeping this export deliberately small prevents the
/// toolchain spike from becoming an accidental production ABI.
#[wasm_bindgen]
pub fn text_engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_crate_version() {
        assert_eq!(text_engine_version(), env!("CARGO_PKG_VERSION"));
    }
}
