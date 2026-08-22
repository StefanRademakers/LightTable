use std::cell::{RefCell, RefMut};
use std::collections::HashMap;
use serde::Deserialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

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
    FillPath {
        #[serde(rename = "pathId")]
        path_id: String,
        transform: [f64; 6],
        #[serde(rename = "fillRule")]
        fill_rule: FillRule,
        color: [f32; 4],
    },
    StrokePath {
        #[serde(rename = "pathId")]
        path_id: String,
        transform: [f64; 6],
        color: [f32; 4],
        stroke: PaintSceneStroke,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum PaintScenePathCommand {
    Move { x: f64, y: f64 },
    Line { x: f64, y: f64 },
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
enum FillRule { Nonzero, Evenodd }

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
enum StrokeCap { Butt, Round, Square }

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum StrokeJoin { Miter, Round, Bevel }

fn bez_path(commands: &[PaintScenePathCommand]) -> vello::kurbo::BezPath {
    let mut path = vello::kurbo::BezPath::new();
    for command in commands {
        match command {
            PaintScenePathCommand::Move { x, y } => path.move_to((*x, *y)),
            PaintScenePathCommand::Line { x, y } => path.line_to((*x, *y)),
            PaintScenePathCommand::Cubic {
                control1_x, control1_y, control2_x, control2_y, x, y
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

fn color(value: [f32; 4]) -> vello::peniko::color::AlphaColor<vello::peniko::color::Srgb> {
    vello::peniko::color::AlphaColor::new(value)
}

fn encode_paint_scene(value: PaintScene) -> Result<vello::Scene, String> {
    use vello::kurbo::{Affine, Cap, Join, Stroke};
    use vello::peniko::Fill;

    let mut scene = vello::Scene::new();
    for fragment in value.fragments {
        let paths: HashMap<String, vello::kurbo::BezPath> = fragment.paths.into_iter()
            .map(|path| (path.stable_id, bez_path(&path.commands)))
            .collect();
        for command in fragment.commands {
            match command {
                PaintSceneCommand::FillPath { path_id, transform, fill_rule, color: paint } => {
                    let path = paths.get(&path_id)
                        .ok_or_else(|| format!("fill references missing path {path_id}"))?;
                    scene.fill(
                        match fill_rule { FillRule::Nonzero => Fill::NonZero, FillRule::Evenodd => Fill::EvenOdd },
                        Affine::new(transform),
                        color(paint),
                        None,
                        path,
                    );
                }
                PaintSceneCommand::StrokePath { path_id, transform, color: paint, stroke } => {
                    let path = paths.get(&path_id)
                        .ok_or_else(|| format!("stroke references missing path {path_id}"))?;
                    let cap = match stroke.cap { StrokeCap::Butt => Cap::Butt, StrokeCap::Round => Cap::Round, StrokeCap::Square => Cap::Square };
                    let join = match stroke.join { StrokeJoin::Miter => Join::Miter, StrokeJoin::Round => Join::Round, StrokeJoin::Bevel => Join::Bevel };
                    let mut style = Stroke::new(stroke.width)
                        .with_caps(cap)
                        .with_join(join)
                        .with_miter_limit(stroke.miter_limit);
                    if !stroke.dash.is_empty() {
                        style = style.with_dashes(stroke.dash_offset, stroke.dash);
                    }
                    scene.stroke(&style, Affine::new(transform), color(paint), None, path);
                }
            }
        }
    }
    Ok(scene)
}

#[wasm_bindgen]
pub struct InteropDevice {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: RefCell<Option<vello::Renderer>>,
}

impl InteropDevice {
    fn renderer_mut(&self) -> Result<RefMut<'_, vello::Renderer>, JsValue> {
        let mut renderer = self.renderer.borrow_mut();
        if renderer.is_none() {
            *renderer = Some(vello::Renderer::new(
                &self.device,
                vello::RendererOptions {
                    use_cpu: false,
                    antialiasing_support: vello::AaSupport::area_only(),
                    num_init_threads: std::num::NonZeroUsize::new(1),
                    pipeline_cache: None,
                },
            ).map_err(|error| JsValue::from_str(&format!("vello renderer: {error}")))?);
        }
        Ok(RefMut::map(renderer, |value| value.as_mut().unwrap()))
    }
}

#[wasm_bindgen]
impl InteropDevice {
    pub async fn create() -> Result<InteropDevice, JsValue> {
        let instance = wgpu::Instance::new(
            wgpu::InstanceDescriptor::new_without_display_handle(),
        );
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .map_err(|error| JsValue::from_str(&format!("adapter: {error}")))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|error| JsValue::from_str(&format!("device: {error}")))?;
        Ok(Self {
            device,
            queue,
            renderer: RefCell::new(None),
        })
    }

    pub fn device_handle(&self) -> Result<JsValue, JsValue> {
        self.device
            .as_webgpu()
            .map(|device| JsValue::from(device.clone()))
            .ok_or_else(|| JsValue::from_str("wgpu did not select the browser WebGPU backend"))
    }

    pub fn render_vello_texture(
        &self,
        texture: JsValue,
        width: u32,
        height: u32,
    ) -> Result<bool, JsValue> {
        let texture = texture
            .dyn_into::<wgpu::webgpu::GpuTexture>()
            .map_err(|_| JsValue::from_str("value is not a GPUTexture"))?;
        let wrapped = self.device.create_texture_from_webgpu_handle(
            texture,
            &wgpu::TextureDescriptor {
                label: Some("LightTable zero-copy interop probe"),
                size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
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
        let mut scene = vello::Scene::new();
        scene.fill(
            vello::peniko::Fill::NonZero,
            vello::kurbo::Affine::IDENTITY,
            vello::peniko::Color::from_rgb8(242, 140, 168),
            None,
            &vello::kurbo::Circle::new((f64::from(width) / 2.0, f64::from(height) / 2.0), 20.0),
        );
        let view = wrapped.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer_mut()?
            .render_to_texture(
                &self.device,
                &self.queue,
                &scene,
                &view,
                &vello::RenderParams {
                    base_color: vello::peniko::Color::from_rgb8(8, 16, 24),
                    width,
                    height,
                    antialiasing_method: vello::AaConfig::Area,
                },
            )
            .map_err(|error| JsValue::from_str(&format!("vello render: {error}")))?;
        Ok(wrapped.size().width == width && wrapped.size().height == height)
    }

    pub fn render_paint_scene_texture(
        &self,
        texture: JsValue,
        width: u32,
        height: u32,
        scene_json: &str,
    ) -> Result<bool, JsValue> {
        let paint_scene: PaintScene = serde_json::from_str(scene_json)
            .map_err(|error| JsValue::from_str(&format!("paint scene JSON: {error}")))?;
        let scene = encode_paint_scene(paint_scene)
            .map_err(|error| JsValue::from_str(&format!("paint scene: {error}")))?;
        let texture = texture
            .dyn_into::<wgpu::webgpu::GpuTexture>()
            .map_err(|_| JsValue::from_str("value is not a GPUTexture"))?;
        let wrapped = self.device.create_texture_from_webgpu_handle(
            texture,
            &wgpu::TextureDescriptor {
                label: Some("LightTable paint-scene interop probe"),
                size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
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
        self.renderer_mut()?.render_to_texture(
            &self.device,
            &self.queue,
            &scene,
            &view,
            &vello::RenderParams {
                base_color: vello::peniko::Color::TRANSPARENT,
                width,
                height,
                antialiasing_method: vello::AaConfig::Area,
            },
        ).map_err(|error| JsValue::from_str(&format!("Vello paint-scene render: {error}")))?;
        Ok(true)
    }
}
