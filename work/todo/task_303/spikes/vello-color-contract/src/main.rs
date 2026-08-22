use vello::kurbo::{Affine, Rect};
use vello::peniko::{
    BrushRef, Fill,
    color::{AlphaColor, LinearSrgb},
};

fn main() {
    let linear = AlphaColor::<LinearSrgb>::new([0.21404114, 0.21404114, 0.21404114, 1.0]);
    let brush: BrushRef<'_> = linear.into();
    if let BrushRef::Solid(srgb) = brush {
        println!("converted_linear={:?}", srgb.convert::<LinearSrgb>());
        println!(
            "draw_color={:08x}",
            vello_encoding::DrawColor::from(srgb).rgba
        );
    }
    let mut scene = vello::Scene::new();
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        linear,
        None,
        &Rect::new(0.0, 0.0, 1.0, 1.0),
    );
    println!("brush={brush:?}");
    println!("draw_data={:08x?}", scene.encoding().draw_data);
}
