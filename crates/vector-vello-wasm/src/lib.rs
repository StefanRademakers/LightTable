use serde::{Deserialize, Serialize};
use std::cell::{RefCell, RefMut};
use std::collections::{HashMap, VecDeque};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;

const MAX_CACHED_SCENES: usize = 64;
const MAX_SCENE_JSON_BYTES: usize = 64 * 1024 * 1024;
const MAX_SCENE_KEY_BYTES: usize = 1024;
const MAX_INCREMENTAL_SOURCES: usize = 64;
const MAX_COMPOSITION_DEPTH: usize = 64;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncrementalProfile {
    total_ms: f64,
    deserialization_ms: f64,
    fragment_encoding_ms: f64,
    scene_synchronization_ms: f64,
    scene_preparation_ms: f64,
    vello_render_submit_cpu_ms: f64,
    actual_gpu_render_ms: Option<f64>,
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

fn now_ms() -> f64 {
    performance_now()
}

#[cfg(feature = "gpu-profiler")]
fn gpu_query_elapsed_ms(query: &wgpu_profiler::GpuTimerQueryResult) -> f64 {
    if let Some(time) = &query.time {
        return (time.end - time.start) * 1000.0;
    }
    query.nested_queries.iter().map(gpu_query_elapsed_ms).sum()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintScene {
    fragments: Vec<PaintSceneFragment>,
    clips: Vec<PaintSceneClip>,
    composition: Vec<PaintSceneCompositionNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintSceneFragment {
    stable_id: String,
    paths: Vec<PaintScenePath>,
    commands: Vec<PaintSceneCommand>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintSceneClip {
    stable_id: String,
    path: PaintScenePath,
    transform: [f64; 6],
    fill_rule: FillRule,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PaintSceneCompositionNode {
    Fragment {
        #[serde(rename = "stableId")]
        stable_id: String,
    },
    OpacityGroup {
        opacity: f32,
        children: Vec<PaintSceneCompositionNode>,
    },
    Clip {
        #[serde(rename = "stableId")]
        stable_id: String,
        children: Vec<PaintSceneCompositionNode>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaintSceneUpdate {
    source_revision: String,
    composition: Option<Vec<PaintSceneCompositionNode>>,
    upserts: Vec<PaintSceneFragment>,
    removals: Vec<String>,
    clip_upserts: Vec<PaintSceneClip>,
    clip_removals: Vec<String>,
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

#[derive(Clone, Copy, Deserialize)]
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

fn encode_paint_scene_fragment(fragment: PaintSceneFragment) -> Result<vello::Scene, String> {
    use vello::kurbo::{Affine, Cap, Join, Stroke};
    use vello::peniko::Fill;

    let mut scene = vello::Scene::new();
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
                        let (brush, brush_transform) = gradient_brush(gradient, path_transform)?;
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
                        let (brush, brush_transform) = gradient_brush(gradient, path_transform)?;
                        scene.stroke(&style, path_transform, &brush, Some(brush_transform), path);
                    }
                }
            }
        }
    }
    if clip_depth != 0 {
        return Err("paint scene fragment leaves clip layers unclosed".into());
    }
    Ok(scene)
}

#[derive(Clone)]
struct EncodedClip {
    path: vello::kurbo::BezPath,
    transform: [f64; 6],
    fill_rule: FillRule,
}

fn encode_clip(clip: PaintSceneClip) -> EncodedClip {
    EncodedClip {
        path: bez_path(&clip.path.commands),
        transform: clip.transform,
        fill_rule: clip.fill_rule,
    }
}

fn append_composition(
    target: &mut vello::Scene,
    nodes: &[PaintSceneCompositionNode],
    fragments: &HashMap<String, IncrementalFragment>,
    clips: &HashMap<String, EncodedClip>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    use vello::kurbo::{Affine, Rect};
    use vello::peniko::{Fill, Mix};

    for node in nodes {
        match node {
            PaintSceneCompositionNode::Fragment { stable_id } => {
                let fragment = fragments.get(stable_id).ok_or_else(|| {
                    format!("composition references missing fragment {stable_id}")
                })?;
                target.append(&fragment.scene, None);
            }
            PaintSceneCompositionNode::Clip {
                stable_id,
                children,
            } => {
                let clip = clips
                    .get(stable_id)
                    .ok_or_else(|| format!("composition references missing clip {stable_id}"))?;
                let fill = match clip.fill_rule {
                    FillRule::Nonzero => Fill::NonZero,
                    FillRule::Evenodd => Fill::EvenOdd,
                };
                target.push_clip_layer(fill, Affine::new(clip.transform), &clip.path);
                append_composition(target, children, fragments, clips, width, height)?;
                target.pop_layer();
            }
            PaintSceneCompositionNode::OpacityGroup { opacity, children } => {
                target.push_layer(
                    Fill::NonZero,
                    Mix::Normal,
                    *opacity,
                    Affine::IDENTITY,
                    &Rect::new(0.0, 0.0, f64::from(width), f64::from(height)),
                );
                append_composition(target, children, fragments, clips, width, height)?;
                target.pop_layer();
            }
        }
    }
    Ok(())
}

fn validate_composition(
    nodes: &[PaintSceneCompositionNode],
    fragments: &HashMap<String, IncrementalFragment>,
    clips: &HashMap<String, EncodedClip>,
    referenced_fragments: &mut std::collections::HashSet<String>,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_COMPOSITION_DEPTH {
        return Err(format!(
            "composition exceeds {MAX_COMPOSITION_DEPTH} levels"
        ));
    }
    for node in nodes {
        match node {
            PaintSceneCompositionNode::Fragment { stable_id } => {
                if !fragments.contains_key(stable_id) {
                    return Err(format!(
                        "composition references missing fragment {stable_id}"
                    ));
                }
                if !referenced_fragments.insert(stable_id.clone()) {
                    return Err(format!(
                        "composition references fragment {stable_id} more than once"
                    ));
                }
            }
            PaintSceneCompositionNode::Clip {
                stable_id,
                children,
            } => {
                if !clips.contains_key(stable_id) {
                    return Err(format!("composition references missing clip {stable_id}"));
                }
                if children.is_empty() {
                    return Err(format!("composition clip {stable_id} has no children"));
                }
                validate_composition(children, fragments, clips, referenced_fragments, depth + 1)?;
            }
            PaintSceneCompositionNode::OpacityGroup { opacity, children } => {
                if !opacity.is_finite() || !(0.0..=1.0).contains(opacity) {
                    return Err(format!(
                        "composition opacity group has invalid opacity {opacity}"
                    ));
                }
                if children.is_empty() {
                    return Err("composition opacity group has no children".into());
                }
                validate_composition(children, fragments, clips, referenced_fragments, depth + 1)?;
            }
        }
    }
    Ok(())
}

fn validate_complete_composition(
    nodes: &[PaintSceneCompositionNode],
    fragments: &HashMap<String, IncrementalFragment>,
    clips: &HashMap<String, EncodedClip>,
) -> Result<(), String> {
    let mut referenced_fragments = std::collections::HashSet::new();
    validate_composition(nodes, fragments, clips, &mut referenced_fragments, 1)?;
    // Retained fragments may be absent from composition while hidden. They
    // stay encoded and warm so visibility changes only mutate composition.
    Ok(())
}

fn encode_paint_scene(value: PaintScene, width: u32, height: u32) -> Result<vello::Scene, String> {
    let mut fragments = HashMap::new();
    for fragment in value.fragments {
        let stable_id = fragment.stable_id.clone();
        if fragments.contains_key(&stable_id) {
            return Err(format!(
                "paint scene contains duplicate fragment {stable_id}"
            ));
        }
        let scene = encode_paint_scene_fragment(fragment)?;
        fragments.insert(stable_id, IncrementalFragment { scene });
    }
    let mut clips = HashMap::new();
    for clip in value.clips {
        let stable_id = clip.stable_id.clone();
        if clips.contains_key(&stable_id) {
            return Err(format!("paint scene contains duplicate clip {stable_id}"));
        }
        clips.insert(stable_id, encode_clip(clip));
    }
    validate_complete_composition(&value.composition, &fragments, &clips)?;
    let mut scene = vello::Scene::new();
    append_composition(
        &mut scene,
        &value.composition,
        &fragments,
        &clips,
        width,
        height,
    )?;
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
        let value = PaintScene {
            fragments: vec![PaintSceneFragment {
                stable_id: "clipped".into(),
                paths: vec![path()],
                commands: vec![
                    PaintSceneCommand::PushClip {
                        path_id: "clip".into(),
                        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                        fill_rule: FillRule::Nonzero,
                    },
                    PaintSceneCommand::PopClip,
                ],
            }],
            clips: vec![],
            composition: vec![PaintSceneCompositionNode::Fragment {
                stable_id: "clipped".into(),
            }],
        };
        assert!(encode_paint_scene(value, 100, 100).is_ok());
    }

    #[test]
    fn rejects_unbalanced_clip_layers() {
        let value = PaintScene {
            fragments: vec![PaintSceneFragment {
                stable_id: "invalid".into(),
                paths: vec![],
                commands: vec![PaintSceneCommand::PopClip],
            }],
            clips: vec![],
            composition: vec![PaintSceneCompositionNode::Fragment {
                stable_id: "invalid".into(),
            }],
        };
        match encode_paint_scene(value, 100, 100) {
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

#[derive(Clone)]
struct IncrementalFragment {
    scene: vello::Scene,
}

struct IncrementalScene {
    source_revision: String,
    composition: Vec<PaintSceneCompositionNode>,
    fragments: HashMap<String, IncrementalFragment>,
    clips: HashMap<String, EncodedClip>,
    compiled: vello::Scene,
}

#[derive(Default)]
struct IncrementalSceneCache {
    entries: HashMap<String, IncrementalScene>,
    order: VecDeque<String>,
}

impl IncrementalSceneCache {
    fn contains(&self, source_id: &str) -> bool {
        self.entries.contains_key(source_id)
    }

    fn insert(&mut self, source_id: String, scene: IncrementalScene) {
        if !self.entries.contains_key(&source_id) {
            while self.entries.len() >= MAX_INCREMENTAL_SOURCES {
                if let Some(oldest) = self.order.pop_front() {
                    self.entries.remove(&oldest);
                } else {
                    self.entries.clear();
                    break;
                }
            }
            self.order.push_back(source_id.clone());
        }
        self.entries.insert(source_id, scene);
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
    }

    fn remove(&mut self, source_id: &str) {
        self.entries.remove(source_id);
        self.order.retain(|candidate| candidate != source_id);
    }
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
    incremental_scenes: RefCell<IncrementalSceneCache>,
    last_incremental_profile: RefCell<IncrementalProfile>,
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

    fn render_scene_to_texture(
        &self,
        texture: JsValue,
        width: u32,
        height: u32,
        scene: &vello::Scene,
    ) -> Result<Option<f64>, JsValue> {
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
        let mut renderer = self.renderer_mut()?;
        renderer
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
        #[cfg(feature = "gpu-profiler")]
        {
            let elapsed = renderer
                .profile_result
                .take()
                .map(|results| results.iter().map(gpu_query_elapsed_ms).sum());
            Ok(elapsed)
        }
        #[cfg(not(feature = "gpu-profiler"))]
        Ok(None)
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
                required_features: {
                    #[cfg(feature = "gpu-profiler")]
                    {
                        let timer_features = wgpu::Features::TIMESTAMP_QUERY
                            | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS
                            | wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES;
                        adapter.features() & timer_features
                    }
                    #[cfg(not(feature = "gpu-profiler"))]
                    wgpu::Features::empty()
                },
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
            "profilingBuild": cfg!(feature = "gpu-profiler"),
            "timestampQueryAvailable": adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY),
            "timestampInsideEncodersAvailable": adapter.features().contains(
                wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS
            ),
            "timestampInsidePassesAvailable": adapter.features().contains(
                wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES
            ),
        })
        .to_string();
        Ok(Self {
            device,
            queue,
            renderer: RefCell::new(None),
            scenes: RefCell::new(SceneCache::default()),
            incremental_scenes: RefCell::new(IncrementalSceneCache::default()),
            last_incremental_profile: RefCell::new(IncrementalProfile::default()),
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
            let scene = encode_paint_scene(paint_scene, width, height)
                .map_err(|error| JsValue::from_str(&format!("paint scene: {error}")))?;
            self.scenes.borrow_mut().insert(scene_key.to_owned(), scene);
        }
        let scenes = self.scenes.borrow();
        let scene = scenes
            .entries
            .get(scene_key)
            .ok_or_else(|| JsValue::from_str("compiled Vello scene cache entry disappeared"))?;
        self.render_scene_to_texture(texture, width, height, scene)?;
        Ok(cache_hit)
    }

    /// Applies a bounded fragment delta and renders the current source scene.
    /// Returns true only when the already-compiled source revision was reused.
    pub fn render_incremental_paint_scene_texture(
        &self,
        texture: JsValue,
        width: u32,
        height: u32,
        source_id: &str,
        update_json: &str,
    ) -> Result<bool, JsValue> {
        let total_started_at = now_ms();
        if source_id.len() > MAX_SCENE_KEY_BYTES {
            return Err(JsValue::from_str(
                "Vello source id exceeds its bounded limit",
            ));
        }
        if update_json.len() > MAX_SCENE_JSON_BYTES {
            return Err(JsValue::from_str(
                "Vello paint-scene update exceeds its bounded JSON limit",
            ));
        }
        let deserialize_started_at = now_ms();
        let update: PaintSceneUpdate = serde_json::from_str(update_json)
            .map_err(|error| JsValue::from_str(&format!("paint scene update JSON: {error}")))?;
        let deserialization_ms = now_ms() - deserialize_started_at;
        let fragment_encoding_started_at = now_ms();
        let mut encoded_upserts = HashMap::new();
        for fragment in update.upserts {
            if encoded_upserts.contains_key(&fragment.stable_id) {
                return Err(JsValue::from_str(
                    "paint scene update contains duplicate upserts",
                ));
            }
            let stable_id = fragment.stable_id.clone();
            let scene = encode_paint_scene_fragment(fragment)
                .map_err(|error| JsValue::from_str(&format!("paint scene fragment: {error}")))?;
            encoded_upserts.insert(stable_id, IncrementalFragment { scene });
        }
        let mut encoded_clip_upserts = HashMap::new();
        for clip in update.clip_upserts {
            if encoded_clip_upserts.contains_key(&clip.stable_id) {
                return Err(JsValue::from_str(
                    "paint scene update contains duplicate clip upserts",
                ));
            }
            let stable_id = clip.stable_id.clone();
            encoded_clip_upserts.insert(stable_id, encode_clip(clip));
        }
        let fragment_encoding_ms = now_ms() - fragment_encoding_started_at;

        let synchronization_started_at = now_ms();
        let mut cache = self.incremental_scenes.borrow_mut();
        let existing = cache.entries.get(source_id);
        let composition = update
            .composition
            .clone()
            .or_else(|| existing.map(|entry| entry.composition.clone()))
            .ok_or_else(|| JsValue::from_str("initial paint scene update requires composition"))?;
        let cache_hit = existing
            .map(|entry| entry.source_revision == update.source_revision)
            .unwrap_or(false)
            && encoded_upserts.is_empty()
            && encoded_clip_upserts.is_empty()
            && update.removals.is_empty()
            && update.clip_removals.is_empty()
            && update.composition.is_none();

        let mut scene_preparation_ms = 0.0;
        if !cache_hit {
            let mut fragments = existing
                .map(|entry| entry.fragments.clone())
                .unwrap_or_default();
            let mut clips = existing
                .map(|entry| entry.clips.clone())
                .unwrap_or_default();
            for removed in update.removals {
                fragments.remove(&removed);
            }
            for removed in update.clip_removals {
                clips.remove(&removed);
            }
            fragments.extend(encoded_upserts);
            clips.extend(encoded_clip_upserts);
            let preparation_started_at = now_ms();
            let mut compiled = vello::Scene::new();
            validate_complete_composition(&composition, &fragments, &clips)
                .map_err(|error| JsValue::from_str(&format!("paint scene composition: {error}")))?;
            append_composition(
                &mut compiled,
                &composition,
                &fragments,
                &clips,
                width,
                height,
            )
            .map_err(|error| JsValue::from_str(&format!("paint scene composition: {error}")))?;
            cache.insert(
                source_id.to_owned(),
                IncrementalScene {
                    source_revision: update.source_revision,
                    composition,
                    fragments,
                    clips,
                    compiled,
                },
            );
            scene_preparation_ms = now_ms() - preparation_started_at;
        }
        let scene_synchronization_ms = now_ms() - synchronization_started_at - scene_preparation_ms;
        let entry = cache
            .entries
            .get(source_id)
            .ok_or_else(|| JsValue::from_str("incremental Vello scene cache entry disappeared"))?;
        let render_started_at = now_ms();
        let actual_gpu_render_ms =
            self.render_scene_to_texture(texture, width, height, &entry.compiled)?;
        let vello_render_submit_cpu_ms = now_ms() - render_started_at;
        *self.last_incremental_profile.borrow_mut() = IncrementalProfile {
            total_ms: now_ms() - total_started_at,
            deserialization_ms,
            fragment_encoding_ms,
            scene_synchronization_ms: scene_synchronization_ms.max(0.0),
            scene_preparation_ms,
            vello_render_submit_cpu_ms,
            actual_gpu_render_ms,
        };
        Ok(cache_hit)
    }

    pub fn incremental_profile_json(&self) -> String {
        serde_json::to_string(&*self.last_incremental_profile.borrow())
            .unwrap_or_else(|_| "{}".to_owned())
    }

    pub fn scene_cache_entries(&self) -> usize {
        self.scenes.borrow().entries.len() + self.incremental_scenes.borrow().entries.len()
    }

    pub fn has_paint_scene_source(&self, source_id: &str) -> bool {
        self.incremental_scenes.borrow().contains(source_id)
    }

    pub fn release_paint_scene_source(&self, source_id: &str) {
        self.incremental_scenes.borrow_mut().remove(source_id);
    }

    pub fn dispose(&self) {
        self.scenes.borrow_mut().clear();
        self.incremental_scenes.borrow_mut().clear();
        *self.renderer.borrow_mut() = None;
    }
}
