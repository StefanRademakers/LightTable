use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen]
pub struct InteropDevice {
    device: wgpu::Device,
    queue: wgpu::Queue,
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
        Ok(Self { device, queue })
    }

    pub fn device_handle(&self) -> Result<JsValue, JsValue> {
        self.device
            .as_webgpu()
            .map(|device| JsValue::from(device.clone()))
            .ok_or_else(|| JsValue::from_str("wgpu did not select the browser WebGPU backend"))
    }

    pub fn wrap_texture(
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
                    | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            },
            None,
        );
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("LightTable zero-copy interop probe encoder"),
        });
        {
            let view = wrapped.create_view(&wgpu::TextureViewDescriptor::default());
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("LightTable zero-copy interop probe clear"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.125,
                            g: 0.5,
                            b: 0.875,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
        }
        self.queue.submit([encoder.finish()]);
        Ok(wrapped.size().width == width && wrapped.size().height == height)
    }
}
