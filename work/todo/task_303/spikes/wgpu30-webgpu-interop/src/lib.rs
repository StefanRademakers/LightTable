use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen]
pub struct InteropDevice {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: RefCell<vello::Renderer>,
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
        let renderer = vello::Renderer::new(
            &device,
            vello::RendererOptions {
                use_cpu: false,
                antialiasing_support: vello::AaSupport::area_only(),
                num_init_threads: std::num::NonZeroUsize::new(1),
                pipeline_cache: None,
            },
        )
        .map_err(|error| JsValue::from_str(&format!("vello renderer: {error}")))?;
        Ok(Self {
            device,
            queue,
            renderer: RefCell::new(renderer),
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
        self.renderer
            .borrow_mut()
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
}
