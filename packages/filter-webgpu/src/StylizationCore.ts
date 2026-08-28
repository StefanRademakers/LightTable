import type {
  P2FilterKind,
  P2FilterSettingsMap,
} from "@lighttable/filter-core";
import { FILTER_FULLSCREEN_VERTEX_WGSL } from "./filterShaders";
import { FilterTargetPool } from "./FilterTargetPool";
import { releaseInactiveFilterRuntimes } from "./FilterRuntimeCache";
export type StylizationMode = Extract<
  P2FilterKind,
  | "smart-blur"
  | "oil-paint"
  | "glowing-edges"
  | "diffuse"
  | "solarize"
  | "cutout"
  | "plastic-wrap"
  | "poster-edges"
  | "watercolor"
  | "photocopy"
  | "halftone-pattern"
  | "stamp"
  | "torn-edges"
  | "texturizer"
>;
export type FilterGalleryStage =
  "smooth" | "edge" | "quantize" | "threshold" | "pattern" | "relief";
export const FILTER_GALLERY_RECIPES: Readonly<
  Record<
    Extract<
      StylizationMode,
      | "cutout"
      | "plastic-wrap"
      | "poster-edges"
      | "watercolor"
      | "photocopy"
      | "halftone-pattern"
      | "stamp"
      | "torn-edges"
      | "texturizer"
    >,
    readonly FilterGalleryStage[]
  >
> = Object.freeze({
  cutout: ["smooth", "quantize"],
  "plastic-wrap": ["smooth", "edge", "relief"],
  "poster-edges": ["quantize", "edge"],
  watercolor: ["smooth", "quantize", "pattern"],
  photocopy: ["edge", "threshold"],
  "halftone-pattern": ["threshold", "pattern"],
  stamp: ["smooth", "threshold"],
  "torn-edges": ["pattern", "threshold", "edge"],
  texturizer: ["pattern", "relief"],
});
interface Runtime {
  readonly uniforms: GPUBuffer;
  revision: number;
}
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const WGSL = /* wgsl */ `
struct Params{a:vec4f,b:vec4f,c:vec4f,mode:u32,option:u32,padding:vec2u}
@group(0)@binding(0)var sourceTexture:texture_2d<f32>;@group(0)@binding(1)var<uniform>params:Params;
fn at(p:vec2i,size:vec2i)->vec4f{return textureLoad(sourceTexture,clamp(p,vec2i(0),size-vec2i(1)),0);}fn straight(v:vec4f)->vec3f{return select(vec3f(0),v.rgb/v.a,v.a>1e-6);}fn lum(v:vec4f)->f32{return dot(straight(v),vec3f(.2126,.7152,.0722));}fn hash(p:vec2f)->f32{return fract(sin(dot(p,vec2f(127.1,311.7))+params.c.w)*43758.5453);}
fn toDisplay(v:vec3f)->vec3f{let c=clamp(v,vec3f(0),vec3f(1));return select(c*12.92,1.055*pow(c,vec3f(1.0/2.4))-.055,c>vec3f(.0031308));}
fn toLinear(v:vec3f)->vec3f{let c=clamp(v,vec3f(0),vec3f(1));return select(c/12.92,pow((c+.055)/1.055,vec3f(2.4)),c>vec3f(.04045));}
fn displayLum(v:vec4f)->f32{return dot(toDisplay(straight(v)),vec3f(.2126,.7152,.0722));}
fn edge(p:vec2i,size:vec2i,step:i32)->f32{let l=lum(at(p+vec2i(-step,0),size));let r=lum(at(p+vec2i(step,0),size));let u=lum(at(p+vec2i(0,-step),size));let d=lum(at(p+vec2i(0,step),size));return length(vec2f(r-l,d-u));}
fn localMean(p:vec2i,size:vec2i,step:i32)->vec4f{var total=vec4f(0);for(var y=-1;y<=1;y+=1){for(var x=-1;x<=1;x+=1){total+=at(p+vec2i(x,y)*step,size);}}return total/9.0;}
@fragment fn stylizeMain(input:VertexOutput)->@location(0)vec4f{let size=vec2i(textureDimensions(sourceTexture));let p=clamp(vec2i(floor(input.uv*vec2f(size))),vec2i(0),size-vec2i(1));let source=at(p,size);let mode=params.mode;
if(mode==0u){let sampleRadius=select(select(1,2,params.a.z>=2.0),4,params.a.z>=3.0);let step=max(1,i32(ceil(params.a.x/f32(sampleRadius))));let center=straight(source);var total=vec4f(0);var weight=0.0;for(var y=-4;y<=4;y+=1){for(var x=-4;x<=4;x+=1){if(abs(x)>sampleRadius||abs(y)>sampleRadius){continue;}let sample=at(p+vec2i(x,y)*step,size);let delta=straight(sample)-center;let w=exp(-dot(delta,delta)/max(params.a.y*params.a.y,1e-5));total+=sample*w;weight+=w;}}let smoothed=total/max(weight,1e-6);if(params.option==1u){let e=edge(p,size,step);return vec4f(vec3f(e)*source.a,source.a);}if(params.option==2u){let e=edge(p,size,step);return vec4f(mix(smoothed.rgb,vec3f(e)*source.a,.5),source.a);}return smoothed;}
if(mode==1u){var best=source;var bestVariance=1e9;let step=max(1,i32(round(params.a.z+params.a.y*.15)));for(var q=0;q<4;q+=1){var mean=vec4f(0);var meanSq=vec3f(0);var count=0.0;for(var y=0;y<=2;y+=1){for(var x=0;x<=2;x+=1){let sx=select(-x,x,q==1||q==3);let sy=select(-y,y,q>=2);let v=at(p+vec2i(sx,sy)*step,size);mean+=v;meanSq+=straight(v)*straight(v);count+=1.0;}}mean/=count;let variance=dot(max(meanSq/count-straight(mean)*straight(mean),vec3f(0)),vec3f(1));if(variance<bestVariance){bestVariance=variance;best=mean;}}let strength=clamp(.25+params.a.x*.075,0.0,1.0);let detail=clamp(edge(p,size,1)*params.a.w*.08,0.0,.35);let painted=mix(best,source,detail);return mix(source,painted,strength);}
if(mode==2u){let e=edge(p,size,max(1,i32(params.a.x)));let glow=pow(clamp(e*params.a.y,0.0,1.0),max(params.a.z,.1));return vec4f(vec3f(glow*.25,glow*.75,glow)*source.a,source.a);}
if(mode==3u){let offset=vec2i(i32(floor(hash(vec2f(p)) * 3.0))-1,i32(floor(hash(vec2f(p)+vec2f(7,3))*3.0))-1);let candidate=at(p+offset,size);let choose=params.option==0u||(params.option==1u&&lum(candidate)<lum(source))||(params.option==2u&&lum(candidate)>lum(source))||(params.option==3u&&edge(p,size,1)<.08);return select(source,mix(source,candidate,params.a.x),choose);}
if(mode==4u){let rgb=toDisplay(straight(source));let level=params.a.x;let result=select(rgb,vec3f(1)-rgb,rgb>vec3f(level));return vec4f(toLinear(result)*source.a,source.a);}
let mean=localMean(p,size,max(1,i32(params.a.y)));let rgb=toDisplay(straight(mean));let e=edge(p,size,max(1,i32(params.a.z)));var out=toDisplay(straight(source));
if(mode==5u){let levels=max(params.a.x,2.0);let quantized=floor(rgb*levels+.5)/levels;out=mix(quantized,toDisplay(straight(source)),clamp(e*params.a.z*.15,0.0,.8));}
else if(mode==6u){out=toDisplay(straight(source))+vec3f(pow(clamp(e*params.a.x,0.0,1.0),2.0));}
else if(mode==7u){let levels=max(params.a.z+2.0,2.0);let posterEdge=edge(p,size,max(1,i32(params.a.x)));out=floor(toDisplay(straight(source))*levels+.5)/levels-vec3f(clamp(posterEdge*params.a.y,0.0,1.0));}
else if(mode==8u){let levels=max(params.a.x,2.0);out=floor(rgb*levels+.5)/levels-vec3f(e*params.a.y*.1);}
else if(mode==9u){let value=1.0-smoothstep(params.a.x,params.a.x+.15,e*params.a.y);out=vec3f(value);}
else if(mode==10u){let frequency=max(params.a.x*4.0,2.0);let cell=fract((vec2f(p)+.5)/frequency)-.5;let coordinate=select(length(cell),abs(cell.y),params.option==1u);let pattern=select(coordinate,abs(length(cell)-.3),params.option==2u);let threshold=displayLum(source)*(1.0+params.a.y);out=vec3f(select(0.0,1.0,pattern<threshold*.5));}
else if(mode==11u){let bias=(params.a.x-.5)*.6;let threshold=mix(.35,displayLum(mean),.25)+bias;out=vec3f(select(0.0,1.0,displayLum(source)>threshold));}
else if(mode==12u){let noiseAmount=clamp(params.a.z/50.0,.05,.5);let roughness=(hash(vec2f(p)/max(params.a.y,1.0))-.5)*noiseAmount;let bias=(params.a.x-.5)*.6;let threshold=mix(.35,displayLum(mean),.2)+bias+roughness;out=vec3f(select(0.0,1.0,displayLum(source)>threshold));}
else{let n=hash(vec2f(p)/max(params.a.x,1.0));let relief=(n-hash((vec2f(p)-vec2f(params.b.xy))/max(params.a.x,1.0)))*params.a.y;out=toDisplay(straight(source))+vec3f(relief);if(params.option==1u){out=vec3f(1)-out;}}
return vec4f(toLinear(max(out,vec3f(0)))*source.a,source.a);}
`;
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: "LightTable Stylization shader",
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${WGSL}`,
  });
  const pipeline = device.createRenderPipeline({
    label: "LightTable Stylization",
    layout: "auto",
    vertex: { module, entryPoint: "filterFullscreenVertex" },
    fragment: {
      module,
      entryPoint: "stylizeMain",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  pipelines.set(device, pipeline);
  return pipeline;
};
const MODES: readonly StylizationMode[] = [
  "smart-blur",
  "oil-paint",
  "glowing-edges",
  "diffuse",
  "solarize",
  "cutout",
  "plastic-wrap",
  "poster-edges",
  "watercolor",
  "photocopy",
  "halftone-pattern",
  "stamp",
  "torn-edges",
  "texturizer",
];
export class StylizationCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly runtimes = new Map<string, Runtime>();
  constructor(
    private readonly device: GPUDevice,
    pool?: FilterTargetPool,
  ) {
    this.pool = pool ?? new FilterTargetPool(device, 1);
    this.ownsPool = !pool;
  }
  configure(width: number, height: number, _sampler: GPUSampler) {
    this.pool.configure(width, height);
  }
  encode<K extends StylizationMode>(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    request: {
      key: string;
      revision: number;
      mode: K;
      settings: P2FilterSettingsMap[K];
    },
  ) {
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable Stylization: ${request.key}`,
          size: 64,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        revision: -1,
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(64);
      const f = new Float32Array(bytes);
      const u = new Uint32Array(bytes);
      u[12] = MODES.indexOf(request.mode);
      const s = request.settings as unknown as Record<string, unknown>;
      const num = (key: string, fallback = 0) => Number(s[key] ?? fallback);
      if (request.mode === "smart-blur") {
        f[0] = num("radius");
        f[1] = num("threshold") / 255;
        f[2] = ["low", "medium", "high"].indexOf(String(s.quality)) + 1;
        u[13] = ["normal", "edge-only", "overlay"].indexOf(String(s.mode));
      } else if (request.mode === "oil-paint") {
        f[0] = num("stylization");
        f[1] = num("cleanliness");
        f[2] = num("scale");
        f[3] = num("bristleDetail");
      } else if (request.mode === "glowing-edges") {
        f[0] = num("width");
        f[1] = num("brightness");
        f[2] = num("smoothness") / 5;
      } else if (request.mode === "diffuse") {
        f[0] = num("amount") / 100;
        f[11] = num("seed");
        u[13] = ["normal", "darken", "lighten", "anisotropic"].indexOf(
          String(s.mode),
        );
      } else if (request.mode === "solarize") {
        f[0] = num("level") / 100;
      } else if (request.mode === "cutout") {
        f[0] = num("levels");
        f[1] = num("edgeSimplicity");
        f[2] = num("edgeFidelity");
      } else if (request.mode === "plastic-wrap") {
        f[0] = num("highlightStrength");
        f[1] = num("smoothness");
        f[2] = num("detail");
      } else if (request.mode === "poster-edges") {
        f[0] = num("thickness");
        f[1] = num("intensity");
        f[2] = num("posterization");
      } else if (request.mode === "watercolor") {
        f[0] = num("brushDetail");
        f[1] = num("shadowIntensity");
        f[2] = num("texture");
      } else if (request.mode === "photocopy") {
        f[0] = num("detail") / 24;
        f[1] = num("darkness");
        f[2] = 1;
      } else if (request.mode === "halftone-pattern") {
        f[0] = num("size");
        f[1] = num("contrast") / 50;
        u[13] = ["dot", "line", "circle"].indexOf(String(s.pattern));
      } else if (request.mode === "stamp") {
        f[0] = num("balance") / 50;
        f[1] = num("smoothness");
      } else if (request.mode === "torn-edges") {
        f[0] = num("balance") / 50;
        f[1] = num("smoothness");
        f[2] = num("contrast");
      } else {
        f[0] = num("scaling") / 10;
        f[1] = num("relief") / 50;
        const light = ["top", "right", "bottom", "left"].indexOf(
          String(s.light),
        );
        f[4] = light === 1 ? 1 : light === 3 ? -1 : 0;
        f[5] = light === 2 ? 1 : light === 0 ? -1 : 0;
        u[13] = s.invert === "yes" ? 1 : 0;
      }
      this.device.queue.writeBuffer(runtime.uniforms, 0, bytes);
      runtime.revision = request.revision;
    }
    const target = this.pool.acquire([source]);
    const pipeline = pipelineFor(this.device);
    const group = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: runtime.uniforms } },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: `LightTable ${request.mode}`,
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
    return target;
  }
  releaseInactive(keys: ReadonlySet<string>) {
    releaseInactiveFilterRuntimes(this.runtimes, keys, (r) =>
      r.uniforms.destroy(),
    );
  }
  estimatedTextureBytes() {
    return this.ownsPool ? this.pool.estimatedTextureBytes() : 0;
  }
  destroy() {
    if (this.ownsPool) this.pool.destroy();
    for (const r of this.runtimes.values()) r.uniforms.destroy();
    this.runtimes.clear();
  }
}
