import {useEffect, useRef} from 'react';
import {Renderer, Program, Mesh, Triangle, Texture} from 'ogl';

type AnimationType = 'rotate' | 'rotate3d' | 'hover';

type PrismaticBurstProps = {
  intensity?: number;
  speed?: number;
  animationType?: AnimationType;
  colors?: string[];
  distort?: number;
  paused?: boolean;
  rayCount?: number;
  mixBlendMode?: React.CSSProperties['mixBlendMode'] | 'none';
};

const vertexShader = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragmentShader = `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uIntensity;
uniform float uSpeed;
uniform int   uAnimType;
uniform vec2  uMouse;
uniform int   uColorCount;
uniform float uDistort;
uniform vec2  uOffset;
uniform sampler2D uGradient;
uniform float uNoiseAmount;
uniform int   uRayCount;

float hash21(vec2 p){
    p = floor(p);
    float f = 52.9829189 * fract(dot(p, vec2(0.065, 0.005)));
    return fract(f);
}
mat2 rot30(){ return mat2(0.8, -0.5, 0.5, 0.8); }
float layeredNoise(vec2 fragPx){
    vec2 p = mod(fragPx + vec2(uTime * 30.0, -uTime * 21.0), 1024.0);
    vec2 q = rot30() * p;
    float n = 0.0;
    n += 0.40 * hash21(q);
    n += 0.25 * hash21(q * 2.0 + 17.0);
    n += 0.20 * hash21(q * 4.0 + 47.0);
    n += 0.10 * hash21(q * 8.0 + 113.0);
    n += 0.05 * hash21(q * 16.0 + 191.0);
    return n;
}
vec3 rayDir(vec2 frag, vec2 res, vec2 offset, float dist){
    float focal = res.y * max(dist, 1e-3);
    return normalize(vec3(2.0 * (frag - offset) - res, focal));
}
float edgeFade(vec2 frag, vec2 res, vec2 offset){
    vec2 toC = frag - 0.5 * res - offset;
    float r = length(toC) / (0.5 * min(res.x, res.y));
    float x = clamp(r, 0.0, 1.0);
    float q = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
    float s = q * 0.5;
    s = pow(s, 1.5);
    float tail = 1.0 - pow(1.0 - s, 2.0);
    s = mix(s, tail, 0.2);
    float dn = (layeredNoise(frag * 0.15) - 0.5) * 0.0015 * s;
    return clamp(s + dn, 0.0, 1.0);
}
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,-s, 0.0,s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,-s,0.0, s,c,0.0, 0.0,0.0,1.0); }
vec3 sampleGradient(float t){
    t = clamp(t, 0.0, 1.0);
    return texture(uGradient, vec2(t, 0.5)).rgb;
}
vec2 rot2(vec2 v, float a){
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c) * v;
}
float bendAngle(vec3 q, float t){
    float a = 0.8 * sin(q.x * 0.55 + t * 0.6)
            + 0.7 * sin(q.y * 0.50 - t * 0.5)
            + 0.6 * sin(q.z * 0.60 + t * 0.7);
    return a;
}
void main(){
    vec2 frag = gl_FragCoord.xy;
    float t = uTime * uSpeed;
    float jitterAmp = 0.1 * clamp(uNoiseAmount, 0.0, 1.0);
    vec3 dir = rayDir(frag, uResolution, uOffset, 1.0);
    float marchT = 0.0;
    vec3 col = vec3(0.0);
    float n = layeredNoise(frag);
    vec4 c = cos(t * 0.2 + vec4(0.0, 33.0, 11.0, 0.0));
    mat2 M2 = mat2(c.x, c.y, c.z, c.w);
    float amp = clamp(uDistort, 0.0, 50.0) * 0.15;
    mat3 rot3dMat = mat3(1.0);
    if(uAnimType == 1){
      vec3 ang = vec3(t * 0.31, t * 0.21, t * 0.17);
      rot3dMat = rotZ(ang.z) * rotY(ang.y) * rotX(ang.x);
    }
    for (int i = 0; i < 44; ++i) {
        vec3 P = marchT * dir;
        P.z -= 2.0;
        float rad = length(P);
        vec3 Pl = P * (10.0 / max(rad, 1e-6));
        if(uAnimType == 0){ Pl.xz *= M2; }
        else if(uAnimType == 1){ Pl = rot3dMat * Pl; }
        float stepLen = min(rad - 0.3, n * jitterAmp) + 0.1;
        float grow = smoothstep(0.35, 3.0, marchT);
        float a1 = amp * grow * bendAngle(Pl * 0.6, t);
        float a2 = 0.5 * amp * grow * bendAngle(Pl.zyx * 0.5 + 3.1, t * 0.9);
        vec3 Pb = Pl;
        Pb.xz = rot2(Pb.xz, a1);
        Pb.xy = rot2(Pb.xy, a2);
        float rayPattern = smoothstep(0.5, 0.7,
            sin(Pb.x + cos(Pb.y) * cos(Pb.z)) *
            sin(Pb.z + sin(Pb.y) * cos(Pb.x + t))
        );
        if (uRayCount > 0) {
            float ang = atan(Pb.y, Pb.x);
            float comb = 0.5 + 0.5 * cos(float(uRayCount) * ang);
            comb = pow(comb, 3.0);
            rayPattern *= smoothstep(0.15, 0.95, comb);
        }
        vec3 spectralDefault = 1.0 + vec3(
            cos(marchT * 3.0 + 0.0),
            cos(marchT * 3.0 + 1.0),
            cos(marchT * 3.0 + 2.0)
        );
        float saw = fract(marchT * 0.25);
        float tRay = saw * saw * (3.0 - 2.0 * saw);
        vec3 userGradient = 2.0 * sampleGradient(tRay);
        vec3 spectral = (uColorCount > 0) ? userGradient : spectralDefault;
        vec3 base = (0.05 / (0.4 + stepLen))
                  * smoothstep(5.0, 0.0, rad)
                  * spectral;
        col += base * rayPattern;
        marchT += stepLen;
    }
    col *= edgeFade(frag, uResolution, uOffset);
    col *= uIntensity;
    vec3 clamped = clamp(col, 0.0, 1.0);
    float alpha = dot(clamped, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(clamped, alpha);
}`;

const hexToRgb01 = (hex: string): [number, number, number] => {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const v = parseInt(h, 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
};

export default function PrismaticBurst({
  intensity = 1.2,
  speed = 0.35,
  animationType = 'rotate3d',
  colors,
  distort = 0,
  paused = false,
  rayCount,
  mixBlendMode = 'lighten',
}: PrismaticBurstProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const programRef = useRef<Program | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const pausedRef = useRef(paused);
  const gradTexRef = useRef<Texture | null>(null);
  const isVisibleRef = useRef(true);
  const meshRef = useRef<Mesh | null>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new Renderer({dpr, alpha: true, antialias: false});
    rendererRef.current = renderer;
    const gl = renderer.gl;
    gl.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    if (mixBlendMode && mixBlendMode !== 'none') {
      (gl.canvas.style as CSSStyleDeclaration).mixBlendMode = mixBlendMode;
    }
    container.appendChild(gl.canvas);

    const gradientTex = new Texture(gl, {
      image: new Uint8Array([255,255,255,255]), width: 1, height: 1,
      generateMipmaps: false, flipY: false,
    });
    gradientTex.minFilter = gl.LINEAR;
    gradientTex.magFilter = gl.LINEAR;
    gradientTex.wrapS = gl.CLAMP_TO_EDGE;
    gradientTex.wrapT = gl.CLAMP_TO_EDGE;
    gradTexRef.current = gradientTex;

    const program = new Program(gl, {
      vertex: vertexShader, fragment: fragmentShader,
      uniforms: {
        uResolution: {value: [1, 1] as [number, number]},
        uTime: {value: 0},
        uIntensity: {value: intensity},
        uSpeed: {value: speed},
        uAnimType: {value: animationType === 'rotate3d' ? 1 : 0},
        uMouse: {value: [0.5, 0.5] as [number, number]},
        uColorCount: {value: 0},
        uDistort: {value: distort},
        uOffset: {value: [0, 0] as [number, number]},
        uGradient: {value: gradientTex},
        uNoiseAmount: {value: 0.8},
        uRayCount: {value: Math.max(0, Math.floor(rayCount ?? 0))},
      },
    });
    programRef.current = program;

    const mesh = new Mesh(gl, {geometry: new Triangle(gl), program});
    meshRef.current = mesh;

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const io = new IntersectionObserver(
      entries => { isVisibleRef.current = entries[0]?.isIntersecting ?? true; },
      {threshold: 0.01}
    );
    io.observe(container);

    let raf = 0, last = performance.now(), accumTime = 0;
    const update = (now: number) => {
      const dt = Math.max(0, now - last) * 0.001;
      last = now;
      if (!pausedRef.current) accumTime += dt;
      if (isVisibleRef.current && !document.hidden) {
        program.uniforms.uTime.value = accumTime;
        renderer.render({scene: mesh});
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      try { container.removeChild(gl.canvas); } catch {}
      programRef.current = null;
      rendererRef.current = null;
      gradTexRef.current = null;
      meshRef.current = null;
    };
  }, []);

  useEffect(() => {
    const p = programRef.current;
    if (!p) return;
    p.uniforms.uIntensity.value = intensity;
    p.uniforms.uSpeed.value = speed;
    p.uniforms.uAnimType.value = animationType === 'rotate3d' ? 1 : 0;
    p.uniforms.uDistort.value = distort;
    p.uniforms.uRayCount.value = Math.max(0, Math.floor(rayCount ?? 0));

    const gl = rendererRef.current?.gl;
    const gradTex = gradTexRef.current;
    if (gl && gradTex && Array.isArray(colors) && colors.length > 0) {
      const capped = colors.slice(0, 64);
      const data = new Uint8Array(capped.length * 4);
      capped.forEach((c, i) => {
        const [r, g, b] = hexToRgb01(c);
        data[i*4] = r*255; data[i*4+1] = g*255; data[i*4+2] = b*255; data[i*4+3] = 255;
      });
      gradTex.image = data; gradTex.width = capped.length; gradTex.height = 1;
      gradTex.needsUpdate = true;
      p.uniforms.uColorCount.value = capped.length;
    } else if (p) {
      p.uniforms.uColorCount.value = 0;
    }
  }, [intensity, speed, animationType, colors, distort, rayCount]);

  return (
    <div ref={containerRef} style={{position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden'}} />
  );
}
