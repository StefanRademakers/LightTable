use serde::Deserialize;
use std::cell::{RefCell, RefMut};
use std::collections::{HashMap, VecDeque};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;

const MAX_CACHED_SCENES: usize = 64;
const MAX_SCENE_JSON_BYTES: usize = 64 * 1024 * 1024;
const MAX_SCENE_KEY_BYTES: usize = 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintScene {
    fragments: Vec<PaintSceneFragment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintSceneFragment {
    paths: Vec<PaintScenePath>,
    commands: Vec<PaintSceneCommand>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintScenePath {
    stable_id: String,
    commands: Vec<PaintScenePathCommand>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PaintSceneCommand {
    PushClip {
        #[serde(rename = "pathId")]
        path_id: String,
        transform: [f64; 6],
        #[serde(rename = "fillRule")]
        fill_rule: FillRule,
    },
    PopClip,
    FillPath {
        #[serde(rename = "pathId")]
        path_id: String,
        transform: [f64; 6],
        #[serde(rename = "fillRule")]
        fill_rule: FillRule,
        paint: PaintScenePaint,
    },
    StrokePath {
        #[serde(rename = "pathId")]
        path_id: String,
        transform: [f64; 6],
        paint: PaintScenePaint,
        stroke: PaintSceneStroke,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PaintScenePaint {
    Solid {
        color: [f32; 4],
    },
    Gradient {
        shape: GradientShape,
        transform: [f64; 6],
        #[serde(rename = "radialFocus")]
        radial_focus: Option<[f64; 2]>,
        #[serde(rename = "radialStartRadius")]
        radial_start_radius: Option<f64>,
        spread: GradientSpread,
        #[serde(rename = "dither")]
        _dither: bool,
        stops: Vec<PaintSceneGradientStop>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintSceneGradientStop {
    offset: f32,
    color: [f32; 4],
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum GradientShape {
    Linear,
    Radial,
    Angle,
    Reflected,
    Diamond,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum GradientSpread {
    Pad,
    Reflect,
    Repeat,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PaintScenePathCommand {
    Move {
        x: f64,
        y: f64,
    },
    Line {
        x: f64,
        y: f64,
    },
    Cubic {
        #[serde(rename = "control1X")]
        control1_x: f64,
        #[serde(rename = "control1Y")]
        control1_y: f64,
        #[serde(rename = "control2X")]
        control2_x: f64,
        #[serde(rename = "control2Y")]
        control2_y: f64,
        x: f64,
        y: f64,
    },
    Close,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum FillRule {
    Nonzero,
    Evenodd,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintSceneStroke {
    width: f64,
    cap: StrokeCap,
    join: StrokeJoin,
    miter_limit: f64,
    dash: Vec<f64>,
    dash_offset: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum StrokeCap {
    Butt,
    Round,
    Square,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum StrokeJoin {
    Miter,
    Round,
    Bevel,
}

fn bez_path(commands: &[PaintScenePathCommand]) -> vello::kurbo::BezPath {
    let mut path = vello::kurbo::BezPath::new();
    for command in commands {
        match command {
            PaintScenePathCommand::Move { x, y } => path.move_to((*x, *y)),
            PaintScenePathCommand::Line { x, y } => path.line_to((*x, *y)),
            PaintScenePathCommand::Cubic {
                control1_x,
                control1_y,
                control2_x,
                control2_y,
                x,
                y,
            } => path.curve_to(
                (*control1_x, *control1_y),
                (*control2_x, *control2_y),
                (*x, *y),
            ),
            PaintScenePathCommand::Close => path.close_path(),
        }
    }
    path
}

fn color(value: [f32; 4]) -> vello::peniko::color::AlphaColor<vello::peniko::color::LinearSrgb> {
    vello::peniko::color::AlphaColor::new(value)
}

fn gradient_brush(
    paint: PaintScenePaint,
    path_transform: vello::kurbo::Affine,
) -> Result<(vello::peniko::Gradient, vello::kurbo::Affine), String> {
    use std::f32::consts::TAU;
    use vello::peniko::{ColorStop, Extend, Gradient};

    let PaintScenePaint::Gradient {
        shape,
        transform,
        radial_focus,
        radial_start_radius,
        spread,
        _dither: _,
        stops,
    } = paint
    else {
        return Err("solid paint passed to gradient encoder".into());
    };
    if stops.is_empty() {
        return Err("gradient has no color stops".into());
    }
    let extend = match spread {
        GradientSpread::Pad => Extend::Pad,
        GradientSpread::Reflect => Extend::Reflect,
        GradientSpread::Repeat => Extend::Repeat,
    };
    let mut encoded_stops: Vec<ColorStop> = stops
        .iter()
        .map(|stop| ColorStop {
            offset: stop.offset.clamp(0.0, 1.0),
            color: color(stop.color).into(),
        })
        .collect();
    let mut gradient = match shape {
        GradientShape::Linear => Gradient::new_linear((0.0, 0.0), (1.0, 0.0)),
        GradientShape::Radial => {
            let focus = radial_focus.unwrap_or([0.0, 0.0]);
            Gradient::new_two_point_radial(
                (focus[0], focus[1]),
                radial_start_radius.unwrap_or(0.0) as f32,
                (0.0, 0.0),
                1.0_f32,
            )
        }
        GradientShape::Angle => Gradient::new_sweep((0.0, 0.0), 0.0, TAU),
        GradientShape::Reflected => {
            let mirrored: Vec<ColorStop> = stops
                .iter()
                .rev()
                .map(|stop| ColorStop {
                    offset: (1.0 - stop.offset.clamp(0.0, 1.0)) * 0.5,
                    color: color(stop.color).into(),
                })
                .chain(stops.iter().map(|stop| ColorStop {
                    offset: 0.5 + stop.offset.clamp(0.0, 1.0) * 0.5,
                    color: color(stop.color).into(),
                }))
                .collect();
            encoded_stops = mirrored;
            Gradient::new_linear((-1.0, 0.0), (1.0, 0.0))
        }
        GradientShape::Diamond => {
            return Err("diamond gradients require the current backend".into());
        }
    };
    gradient = gradient
        .with_extend(extend)
        .with_stops(encoded_stops.as_slice());
    let scene_transform = vello::kurbo::Affine::new(transform);
    Ok((gradient, path_transform.inverse() * scene_transform))
}

fn encode_paint_scene(value: PaintScene) -> Result<vello::Scene, String> {
    use vello::kurbo::{Affine, Cap, Join, Stroke};
    use vello::peniko::Fill;

    let mut scene = vello::Scene::new();
    for fragment in value.fragments {
        let mut clip_depth = 0usize;
        let paths: HashMap<String, vello::kurbo::BezPath> = fragment
            .paths
            .into_iter()
            .map(|path| (path.stable_id, bez_path(&path.commands)))
            .collect();
        for command in fragment.commands {
            match command {
                PaintSceneCommand::PushClip {
                    path_id,
                    transform,
                    fill_rule,
                } => {
                    let path = paths
                        .get(&path_id)
                        .ok_or_else(|| format!("clip references missing path {path_id}"))?;
                    let fill = match fill_rule {
                        FillRule::Nonzero => Fill::NonZero,
                        FillRule::Evenodd => Fill::EvenOdd,
                    };
                    scene.push_clip_layer(fill, Affine::new(transform), path);
                    clip_depth += 1;
                }
                PaintSceneCommand::PopClip => {
                    if clip_depth == 0 {
                        return Err("paint scene pops an empty clip stack".into());
                    }
                    scene.pop_layer();
                    clip_depth -= 1;
                }
                PaintSceneCommand::FillPath {
                    path_id,
                    transform,
                    fill_rule,
                    paint,
                } => {
                    let path = paths
                        .get(&path_id)
                        .ok_or_else(|| format!("fill references missing path {path_id}"))?;
                    let path_transform = Affine::new(transform);
                    let fill = match fill_rule {
                        FillRule::Nonzero => Fill::NonZero,
                        FillRule::Evenodd => Fill::EvenOdd,
                    };
                    match paint {
                        PaintScenePaint::Solid { color: paint } => {
                            scene.fill(fill, path_transform, color(paint), None, path);
                        }
                        gradient @ PaintScenePaint::Gradient { .. } => {
                            let (brush, brush_transform) =
                                gradient_brush(gradient, path_transform)?;
                            scene.fill(fill, path_transform, &brush, Some(brush_transform), path);
                        }
                    }
                }
                PaintSceneCommand::StrokePath {
                    path_id,
                    transform,
                    paint,
                    stroke,
                } => {
                    let path = paths
                        .get(&path_id)
                        .ok_or_else(|| format!("stroke references missing path {path_id}"))?;
                    let cap = match stroke.cap {
                        StrokeCap::Butt => Cap::Butt,
                        StrokeCap::Round => Cap::Round,
                        StrokeCap::Square => Cap::Square,
                    };
                    let join = match stroke.join {
                        StrokeJoin::Miter => Join::Miter,
                        StrokeJoin::Round => Join::Round,
                        StrokeJoin::Bevel => Join::Bevel,
                    };
                    let mut style = Stroke::new(stroke.width)
                        .with_caps(cap)
                        .with_join(join)
                        .with_miter_limit(stroke.miter_limit);
                    if !stroke.dash.is_empty() {
                        style = style.with_dashes(stroke.dash_offset, stroke.dash);
                    }
                    let path_transform = Affine::new(transform);
                    match paint {
                        PaintScenePaint::Solid { color: paint } => {
                            scene.stroke(&style, path_transform, color(paint), None, path);
                        }
                        gradient @ PaintScenePaint::Gradient { .. } => {
                            let (brush, brush_transform) =
                                gradient_brush(gradient, path_transform)?;
                            scene.stroke(
                                &style,
                                path_transform,
                                &brush,
                                Some(brush_transform),
                                path,
                            );
                        }
                    }
                }
            }
        }
        if clip_depth != 0 {
            return Err("paint scene fragment leaves clip layers unclosed".into());
        }
    }
    Ok(scene)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod paint_scene_tests {
    use super::*;

    fn path() -> PaintScenePath {
        PaintScenePath {
            stable_id: "clip".into(),
            commands: vec![
                PaintScenePathCommand::Move { x: 0.0, y: 0.0 },
                PaintScenePathCommand::Line { x: 10.0, y: 0.0 },
                PaintScenePathCommand::Line { x: 10.0, y: 10.0 },
                PaintScenePathCommand::Close,
            ],
        }
    }

    #[test]
    fn accepts_balanced_clip_layers() {
        let value = PaintScene { fragments: vec![PaintSceneFragment {
            paths: vec![path()],
            commands: vec![
                PaintSceneCommand::PushClip {
                    path_id: "clip".into(),
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    fill_rule: FillRule::Nonzero,
                },
                PaintSceneCommand::PopClip,
            ],
        }] };
        assert!(encode_paint_scene(value).is_ok());
    }

    #[test]
    fn rejects_unbalanced_clip_layers() {
        let value = PaintScene { fragments: vec![PaintSceneFragment {
            paths: vec![], commands: vec![PaintSceneCommand::PopClip],
        }] };
        match encode_paint_scene(value) {
            Err(message) => assert_eq!(message, "paint scene pops an empty clip stack"),
            Ok(_) => panic!("unbalanced clip stack was accepted"),
        }
    }
}

#[derive(Default)]
struct SceneCache {
    entries: HashMap<String, vello::Scene>,
    order: VecDeque<String>,
}

impl SceneCache {
    fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    fn insert(&mut self, key: String, scene: vello::Scene) {
        if self.entries.contains_key(&key) {
            return;
        }
        while self.entries.len() >= MAX_CACHED_SCENES {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            } else {
                self.entries.clear();
                break;
            }
        }
        self.order.push_back(key.clone());
        self.entries.insert(key, scene);
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
    }
}

#[wasm_bindgen]
pub struct VelloInteropDevice {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: RefCell<Option<vello::Renderer>>,
    scenes: RefCell<SceneCache>,
    diagnostics_json: String,
}

impl VelloInteropDevice {
    fn renderer_mut(&self) -> Result<RefMut<'_, vello::Renderer>, JsValue> {
        let mut renderer = self.renderer.borrow_mut();
        if renderer.is_none() {
            *renderer = Some(
                vello::Renderer::new(
                    &self.device,
                    vello::RendererOptions {
                        use_cpu: false,
                        antialiasing_support: vello::AaSupport::area_only(),
                        num_init_threads: std::num::NonZeroUsize::new(1),
                        pipeline_cache: None,
                    },
                )
                .map_err(|error| JsValue::from_str(&format!("Vello renderer: {error}")))?,
            );
        }
        Ok(RefMut::map(renderer, |value| value.as_mut().unwrap()))
    }
}

#[wasm_bindgen]
impl VelloInteropDevice {
    pub async fn create() -> Result<VelloInteropDevice, JsValue> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: None,
                apply_limit_buckets: false,
            })
            .await
            .map_err(|error| JsValue::from_str(&format!("WebGPU adapter: {error}")))?;
        let adapter_info = adapter.get_info();
        let adapter_limits = adapter.limits();
        let mut required_limits = wgpu::Limits::default();
        required_limits.max_texture_dimension_2d = adapter_limits.max_texture_dimension_2d;
        required_limits.max_buffer_size = adapter_limits.max_buffer_size;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("LightTable shared Vello WebGPU device"),
                required_features: wgpu::Features::empty(),
                required_limits,
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::MemoryUsage,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|error| JsValue::from_str(&format!("WebGPU device: {error}")))?;
        let diagnostics_json = serde_json::json!({
            "vendor": adapter_info.vendor,
            "architecture": format!("{:?}", adapter_info.device_type),
            "device": adapter_info.device,
            "description": adapter_info.name,
            "backend": format!("{:?}", adapter_info.backend),
            "maxTextureDimension2D": adapter_limits.max_texture_dimension_2d,
            "maxBufferSize": adapter_limits.max_buffer_size,
        })
        .to_string();
        Ok(Self {
            device,
            queue,
            renderer: RefCell::new(None),
            scenes: RefCell::new(SceneCache::default()),
            diagnostics_json,
        })
    }

    pub fn device_handle(&self) -> Result<JsValue, JsValue> {
        self.device
            .as_webgpu()
            .map(|device| JsValue::from(device.clone()))
            .ok_or_else(|| JsValue::from_str("wgpu did not select the browser WebGPU backend"))
    }

    pub fn diagnostics_json(&self) -> String {
        self.diagnostics_json.clone()
    }

    /// Returns true when the compiled Vello scene was already cached.
    pub fn render_paint_scene_texture(
        &self,
        texture: JsValue,
        width: u32,
        height: u32,
        scene_key: &str,
        scene_json: &str,
    ) -> Result<bool, JsValue> {
        if scene_key.len() > MAX_SCENE_KEY_BYTES {
            return Err(JsValue::from_str(
                "Vello scene key exceeds its bounded limit",
            ));
        }
        if scene_json.len() > MAX_SCENE_JSON_BYTES {
            return Err(JsValue::from_str(
                "Vello paint scene exceeds its bounded JSON limit",
            ));
        }
        let cache_hit = self.scenes.borrow().contains(scene_key);
        if !cache_hit {
            let paint_scene: PaintScene = serde_json::from_str(scene_json)
                .map_err(|error| JsValue::from_str(&format!("paint scene JSON: {error}")))?;
            let scene = encode_paint_scene(paint_scene)
                .map_err(|error| JsValue::from_str(&format!("paint scene: {error}")))?;
            self.scenes.borrow_mut().insert(scene_key.to_owned(), scene);
        }
        let texture = texture
            .dyn_into::<wgpu::webgpu::GpuTexture>()
            .map_err(|_| JsValue::from_str("value is not a GPUTexture"))?;
        let wrapped = self.device.create_texture_from_webgpu_handle(
            texture,
            &wgpu::TextureDescriptor {
                label: Some("LightTable Vello paint-scene surface"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::STORAGE_BINDING,
                view_formats: &[],
            },
            None,
        );
        let view = wrapped.create_view(&wgpu::TextureViewDescriptor::default());
        let scenes = self.scenes.borrow();
        let scene = scenes
            .entries
            .get(scene_key)
            .ok_or_else(|| JsValue::from_str("compiled Vello scene cache entry disappeared"))?;
        self.renderer_mut()?
            .render_to_texture(
                &self.device,
                &self.queue,
                scene,
                &view,
                &vello::RenderParams {
                    base_color: vello::peniko::Color::TRANSPARENT,
                    width,
                    height,
                    antialiasing_method: vello::AaConfig::Area,
                },
            )
            .map_err(|error| JsValue::from_str(&format!("Vello paint-scene render: {error}")))?;
        Ok(cache_hit)
    }

    pub fn scene_cache_entries(&self) -> usize {
        self.scenes.borrow().entries.len()
    }

    pub fn dispose(&self) {
        self.scenes.borrow_mut().clear();
        *self.renderer.borrow_mut() = None;
    }
}
