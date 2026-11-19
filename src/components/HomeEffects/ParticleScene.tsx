import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Geometry, Mesh, Program, Renderer} from 'ogl';
import {useHomeMotion} from './index';
import styles from './styles.module.css';

const vertex = /* glsl */ `
  precision highp float;
  attribute vec4 seed;
  uniform float uTime;
  uniform float uAspect;
  uniform float uScale;
  uniform float uDpr;
  uniform vec2 uPointer;
  uniform float uPointerStrength;
  varying vec3 vColor;
  varying float vOpacity;

  vec3 curve(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec3(c / (1.0 + s * s) * 2.6, s * c / (1.0 + s * s) * 2.6, s * 0.85);
  }

  void main() {
    float angle = seed.x * 6.2831853 + uTime * 0.28;
    vec3 center = curve(angle);
    vec3 tangent = normalize(curve(angle + 0.01) - curve(angle - 0.01));
    vec3 normal = normalize(cross(tangent, vec3(0.0, 0.0, 1.0)));
    vec3 binormal = normalize(cross(tangent, normal));
    float tubeAngle = seed.y * 6.2831853 + uTime * 0.18;
    float radius = sqrt(seed.z) * (seed.w > 0.9 ? 0.44 : 0.24);
    vec3 p = center + normal * cos(tubeAngle) * radius + binormal * sin(tubeAngle) * radius;
    p += vec3(sin(p.y * 3.0 + uTime * 0.6), cos(p.z * 3.0 - uTime * 0.4), sin(p.x * 2.0 + uTime * 0.5)) * 0.075;

    float yaw = sin(uTime * 0.12) * 0.32 + uPointer.x * 0.12 * uPointerStrength;
    p.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * p.xz;
    float pitch = 0.3 + sin(uTime * 0.17) * 0.12;
    p.yz = mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch)) * p.yz;
    float roll = mix(-0.68, -0.23, smoothstep(1.0, 2.3, uAspect));
    p.xy = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * p.xy;
    float perspective = 5.0 / (4.7 + p.z);
    vec2 screen = p.xy * 0.7 * perspective * uScale;
    screen.x /= uAspect;
    vec2 delta = screen - uPointer;
    float distanceToPointer = length(delta);
    float influence = (1.0 - smoothstep(0.0, 0.32, distanceToPointer)) * uPointerStrength;
    screen += delta / max(distanceToPointer, 0.02) * influence * 0.1;
    gl_Position = vec4(screen, 0.0, 1.0);
    gl_PointSize = (1.25 + seed.w * 2.2) * uDpr * perspective;
    float highlight = smoothstep(-0.6, 0.8, p.z) * 0.65 + seed.y * 0.35;
    vColor = mix(vec3(0.18, 0.4, 1.0), vec3(0.94, 0.98, 1.0), highlight);
    vOpacity = mix(0.2, 0.8, seed.w) + influence * 0.2;
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    float radius = length(gl_PointCoord - 0.5);
    if (radius > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.1, 0.5, radius)) * vOpacity;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export function ParticleScene(): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const control = useRef<{sync: () => void} | null>(null);
  const {reducedMotion} = useHomeMotion();
  const preference = useRef(reducedMotion);
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    preference.current = reducedMotion;
    control.current?.sync();
  }, [reducedMotion]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    setReady(false);
    if (!canvas.getContext('webgl', {alpha: true, depth: false, antialias: false, premultipliedAlpha: false})) return;
    const renderer = new Renderer({
      canvas,
      alpha: true,
      depth: false,
      antialias: false,
      webgl: 1,
      dpr: Math.min(window.devicePixelRatio || 1, 1.5),
      powerPreference: 'low-power',
    });
    const {gl} = renderer;
    const seeds = new Float32Array(65536 * 4);
    let random = 41729;
    for (let index = 0; index < seeds.length; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) | 0;
      seeds[index] = (random >>> 0) / 4294967296;
    }
    const geometry = new Geometry(gl, {seed: {size: 4, data: seeds}});
    const uniforms = {
      uTime: {value: 0},
      uAspect: {value: 1},
      uScale: {value: 1},
      uDpr: {value: renderer.dpr},
      uPointer: {value: new Float32Array([0, 0])},
      uPointerStrength: {value: 0},
    };
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    program.setBlendFunc(gl.SRC_ALPHA, gl.ONE);
    if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      geometry.remove();
      program.remove();
      return;
    }
    const mesh = new Mesh(gl, {geometry, program, mode: gl.POINTS, frustumCulled: false});
    let frame = 0;
    let lastTime = 0;
    let elapsed = 0;
    let visible = true;
    let lost = false;
    let mobile = false;
    const pointer = {x: 0, y: 0, strength: 0};

    function render() {
      uniforms.uTime.value = elapsed;
      renderer.render({scene: mesh, frustumCull: false, sort: false});
    }
    function tick(now: number) {
      const interval = mobile ? 1000 / 30 : 1000 / 45;
      if (!lastTime) lastTime = now;
      if (now - lastTime >= interval) {
        elapsed += Math.min((now - lastTime) / 1000, 0.08);
        lastTime = now;
        uniforms.uPointer.value[0] += (pointer.x - uniforms.uPointer.value[0]) * 0.08;
        uniforms.uPointer.value[1] += (pointer.y - uniforms.uPointer.value[1]) * 0.08;
        uniforms.uPointerStrength.value += (pointer.strength - uniforms.uPointerStrength.value) * 0.08;
        render();
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      lastTime = 0;
      const paused = !visible || document.hidden || preference.current;
      host!.toggleAttribute('data-motion-paused', paused);
      if (lost) return;
      if (!paused) frame = requestAnimationFrame(tick);
      else render();
    }
    function resize() {
      if (lost) return;
      const box = host!.getBoundingClientRect();
      if (!box.width || !box.height) return;
      renderer.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setSize(box.width, box.height);
      uniforms.uAspect.value = box.width / box.height;
      uniforms.uScale.value = Math.min(1, uniforms.uAspect.value / 2.2);
      uniforms.uDpr.value = renderer.dpr;
      mobile = box.width < 760;
      geometry.setDrawRange(0, mobile ? 24576 : 65536);
      render();
    }
    function move(event: globalThis.PointerEvent) {
      if (event.pointerType !== 'mouse' || preference.current) return;
      const box = host!.getBoundingClientRect();
      pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
      pointer.y = 1 - ((event.clientY - box.top) / box.height) * 2;
      pointer.strength = 1;
    }
    function leave() {
      pointer.strength = 0;
    }
    function contextLost(event: Event) {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      setReady(false);
    }
    function contextRestored() {
      setGeneration((value) => value + 1);
    }
    const resizeObserver = new ResizeObserver(resize);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    resizeObserver.observe(host);
    observer.observe(host);
    document.addEventListener('visibilitychange', sync);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    control.current = {sync};
    resize();
    sync();
    setReady(true);
    return () => {
      cancelAnimationFrame(frame);
      control.current = null;
      resizeObserver.disconnect();
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      if (!lost) {
        geometry.remove();
        program.remove();
        gl.deleteShader(program.vertexShader);
        gl.deleteShader(program.fragmentShader);
      }
    };
  }, [generation]);

  return (
    <div ref={hostRef} className={styles.particleScene} data-ready={ready ? '' : undefined} aria-hidden="true">
      <div className={styles.particleGlow} />
      <div className={styles.particleGrid} />
      <svg className={styles.particleFallback} viewBox="0 0 1000 440" fill="none">
        {[36, 20, 2].map((width) => (
          <path
            key={width}
            d="M500 220C360 30 135 80 155 235C175 390 350 370 500 220C650 70 825 50 845 205C865 360 640 410 500 220Z"
            stroke={width === 2 ? '#d2e6ff' : '#477cf5'}
            strokeWidth={width}
            opacity={width === 2 ? 0.8 : 0.2}
            strokeDasharray={width === 2 ? '1 4' : undefined}
          />
        ))}
      </svg>
      <canvas ref={canvasRef} className={styles.particleCanvas} />
      <div className={styles.particleLegend}>
        <span>FEEI / FIELD NOTES</span>
        <span>探索，持续发生。</span>
      </div>
    </div>
  );
}
