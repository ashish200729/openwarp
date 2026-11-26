"use client";

import { useEffect, useRef, type ComponentProps } from "react";

type DigitFieldProps = Omit<ComponentProps<"canvas">, "color"> & {
  accentColor?: string;
  color?: string;
  dotSize?: number;
  fps?: number;
  level?: number;
  smoke?: number;
  speed?: number;
  strength?: number;
  waveHeight?: number;
};

const vertexSource = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uSize;
uniform float uDot, uTime, uLevel, uWave, uMist, uStrength;
uniform vec3 uColor, uCrest;
out vec4 outColor;

// Each glyph is 3 x 5 dots, packed from the bottom row up.
const int GLYPHS[10] = int[10](31599, 9879, 31183, 31207, 23524, 29671, 29679, 31012, 31727, 31719);

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float flow(vec2 p) {
  return noise(p) * 0.62 + noise(p * 2.07 + 11.3) * 0.38;
}

float surface(float x, float aspect) {
  float wide = smoothstep(0.9, 1.7, aspect);
  float reach = x * mix(1.4, 2.6, wide);
  float swell = sin(reach * 2.1 - uTime * 0.42) * 0.050
    + sin(reach * 3.7 + uTime * 0.31 + 1.4) * 0.026
    + sin(reach * 6.1 - uTime * 0.55 + 4.0) * 0.010;
  // On wide screens the swell climbs into the space beside the headline.
  float climb = wide * 0.46 * smoothstep(0.42, 1.04, x);
  return uLevel + climb + swell * uWave;
}

void main() {
  vec2 dots = floor(gl_FragCoord.xy / uDot);
  vec2 cellSize = vec2(4.0, 6.0);
  vec2 cell = floor(dots / cellSize);
  vec2 local = dots - cell * cellSize;
  float aspect = uSize.x / uSize.y;
  float unit = uSize.y / uDot;

  vec2 uv = (cell + 0.5) * cellSize * uDot / uSize;
  float depth = (surface(uv.x, aspect) - uv.y) * unit;
  vec2 drift = cell * vec2(0.034, 0.075);
  float light = flow(drift + vec2(-uTime * 0.16, uTime * 0.07));
  float glint = flow(drift * 1.9 + vec2(uTime * 0.11, 5.0 - uTime * 0.05));

  float dissolve = smoothstep(-26.0, 5.0, depth + (hash(cell) - 0.5) * 20.0);
  float crest = exp(-max(depth, 0.0) / (13.0 + 22.0 * light)) * smoothstep(-15.0, 3.0, depth);
  float body = (0.16 + 0.72 * smoothstep(0.32, 0.8, light)) * mix(0.55, 1.0, glint) * exp(-max(depth, 0.0) / (unit * 0.55));

  int digit = int(mod(floor(depth * 0.085 + light * 7.0 + uTime * 0.22), 10.0));
  bool inside = local.x < 3.0 && local.y < 5.0;
  float lit = inside ? float((GLYPHS[digit] >> int(local.y * 3.0 + local.x)) & 1) : 0.0;

  float ink = clamp(max(crest, body) * dissolve, 0.0, 1.0) * lit * uStrength;
  vec3 inkColor = mix(uColor, uCrest, smoothstep(0.25, 0.85, crest));

  // A soft bloom, sampled per pixel, sits above and below the surface.
  vec2 fine = gl_FragCoord.xy / uSize;
  float near = (surface(fine.x, aspect) - fine.y) * unit;
  float veil = flow(vec2(fine.x * 3.2 * aspect * 0.6 - uTime * 0.05, fine.y * 3.0 - uTime * 0.09));
  float bloom = near < 0.0 ? exp(near / 46.0) : 0.35 + 0.65 * exp(-near / 70.0);
  float mist = bloom * smoothstep(0.22, 0.85, veil) * 0.34 * uMist + bloom * 0.07 * uMist;
  mist += (hash(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.004, mist);

  float alpha = ink + mist * (1.0 - ink);
  outColor = vec4(inkColor * ink + uColor * mist * (1.0 - ink), alpha);
}`;

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  if (process.env.NODE_ENV !== "production") {
    console.error(gl.getProgramInfoLog(program), ...(gl.getAttachedShaders(program) ?? []).map((shader) => gl.getShaderInfoLog(shader)));
  }
  return null;
}

// Reads any CSS color, including light-dark() results and wide-gamut notations, as sRGB channels.
function readColor(value: string): [number, number, number] {
  const context = new OffscreenCanvas(1, 1).getContext("2d");
  if (!context) return [0, 0, 0];
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255];
}

export function DigitField({
  accentColor = "var(--foreground)", color = "#0a7cff", dotSize = 2, fps = 40, level = 0.38,
  smoke = 1, speed = 0.5, strength = 1, waveHeight = 1, style, ...props
}: DigitFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ dotSize, fps, level, smoke, speed, strength, waveHeight });
  const refresh = useRef<() => void>(undefined);

  useEffect(() => {
    settings.current = { dotSize, fps, level, smoke, speed, strength, waveHeight };
    refresh.current?.();
  }, [accentColor, color, dotSize, fps, level, smoke, speed, strength, waveHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!canvas || !gl) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    let program: WebGLProgram | null = null;
    let uniform: (name: string) => WebGLUniformLocation | null = () => null;
    let frame = 0;
    let onScreen = false;
    let lastDraw = 0;
    let time = 14;

    function setUp() {
      program = createProgram(gl!);
      if (!program) return;
      const locations = new Map<string, WebGLUniformLocation | null>();
      uniform = (name) => {
        if (!locations.has(name)) locations.set(name, gl!.getUniformLocation(program!, name));
        return locations.get(name)!;
      };
      gl!.useProgram(program);
      readColors();
    }

    function readColors() {
      if (!program) return;
      const computed = getComputedStyle(canvas!);
      gl!.uniform3fv(uniform("uColor"), readColor(computed.color));
      gl!.uniform3fv(uniform("uCrest"), readColor(computed.caretColor));
    }

    function draw() {
      if (!program || gl!.isContextLost()) return;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(canvas!.clientWidth * ratio);
      const height = Math.round(canvas!.clientHeight * ratio);
      if (!width || !height) return;
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
        gl!.viewport(0, 0, width, height);
      }
      const current = settings.current;
      gl!.uniform2f(uniform("uSize"), width, height);
      gl!.uniform1f(uniform("uDot"), Math.max(1, Math.round(current.dotSize * ratio)));
      gl!.uniform1f(uniform("uTime"), time);
      gl!.uniform1f(uniform("uLevel"), current.level);
      gl!.uniform1f(uniform("uWave"), current.waveHeight);
      gl!.uniform1f(uniform("uMist"), current.smoke);
      gl!.uniform1f(uniform("uStrength"), current.strength);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }

    function shouldAnimate() {
      return onScreen && !document.hidden && !reducedMotion.matches && settings.current.speed > 0;
    }

    function tick(now: number) {
      frame = 0;
      if (!shouldAnimate()) return;
      const elapsed = now - lastDraw;
      if (elapsed >= 1000 / settings.current.fps - 2) {
        // A long gap means the page was paused, so continue from the last frame instead of jumping.
        time += Math.min(elapsed, 100) / 1000 * settings.current.speed * 2;
        lastDraw = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }

    function update() {
      if (onScreen) draw();
      if (shouldAnimate() && !frame) frame = requestAnimationFrame(tick);
    }

    function updateColors() {
      readColors();
      update();
    }

    function contextLost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(frame);
      frame = 0;
      program = null;
    }

    function contextRestored() {
      setUp();
      update();
    }

    setUp();
    refresh.current = updateColors;
    const visibility = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; update(); });
    const size = new ResizeObserver(update);
    const theme = new MutationObserver(updateColors);
    visibility.observe(canvas);
    size.observe(canvas);
    theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", update);
    reducedMotion.addEventListener("change", update);
    darkScheme.addEventListener("change", updateColors);
    canvas.addEventListener("webglcontextlost", contextLost);
    canvas.addEventListener("webglcontextrestored", contextRestored);

    return () => {
      cancelAnimationFrame(frame);
      refresh.current = undefined;
      visibility.disconnect();
      size.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", update);
      reducedMotion.removeEventListener("change", update);
      darkScheme.removeEventListener("change", updateColors);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ ...style, color, caretColor: accentColor }} {...props} />;
}
