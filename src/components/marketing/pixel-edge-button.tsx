"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { primaryButton } from "@/components/ui";
import { cn } from "@/lib/utils";

// A faint scatter of square pixels lines the inside of the button, densest at the border and
// fading inward. The label seeds where the pixels gather, so the pattern is uneven, like
// worn print. On hover a brighter band of pixels travels around the edge.

const pitch = 2;
const falloff = [0.36, 0.12, 0.04, 0.012];
const lapTime = 2400;
const frameTime = 1000 / 30;
const cornerCells = 3.5;

function hash(a: number, b: number, c: number) {
  let value = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function seedOf(text: string) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

// Smooth noise around the perimeter decides which stretches of the edge carry pixels.
function perimeterNoise(seed: number) {
  const points = Array.from({ length: 14 }, (_, index) => hash(index, 7, seed));
  return (position: number) => {
    const scaled = position * points.length;
    const index = Math.floor(scaled);
    const fraction = scaled - index;
    const eased = fraction * fraction * (3 - 2 * fraction);
    return points[index % points.length] * (1 - eased) + points[(index + 1) % points.length] * eased;
  };
}

type Colors = { ink: string; cool: string; warm: string };

export function PixelEdgeButton({ href, children, className }: { href: string; children: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const element = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !element || !context) return;
    const seed = seedOf(children);
    const noise = perimeterNoise(seed);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    let colors: Colors = { ink: "#000", cool: "#000", warm: "#000" };
    let width = 0, height = 0, ratio = 1;
    let energy = 0, target = 0, pulse = 0, time = 0, frame = 0, last = 0, drawn = 0, onScreen = true;

    function readColors() {
      // Computed colors arrive resolved, including light-dark() values.
      const style = getComputedStyle(canvas!);
      colors = { ink: style.color, cool: style.caretColor, warm: style.outlineColor };
    }

    function draw() {
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      context!.clearRect(0, 0, width, height);
      const columns = Math.floor(width / pitch), rows = Math.floor(height / pitch);
      if (columns < 8 || rows < 8) return;
      const offsetX = (width - columns * pitch) / 2, offsetY = (height - rows * pitch) / 2;
      const size = ratio >= 2 ? 1.5 : 1;
      const inset = (pitch - size) / 2;
      const perimeter = 2 * (columns + rows);
      const band = (time / lapTime) % 1;
      const twinkle = Math.floor(time / 110);

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const depth = Math.min(x, y, columns - 1 - x, rows - 1 - y);
          if (depth >= falloff.length) continue;
          // Leave the rounded corners empty.
          const cornerX = Math.min(x + 0.5, columns - x - 0.5), cornerY = Math.min(y + 0.5, rows - y - 0.5);
          if (cornerX < cornerCells && cornerY < cornerCells && Math.hypot(cornerCells - cornerX, cornerCells - cornerY) > cornerCells) continue;

          const along = depth === y ? x : depth === columns - 1 - x ? columns + y : depth === rows - 1 - y ? columns + rows + (columns - x) : 2 * columns + rows + (rows - y);
          const position = along / perimeter;
          const gather = 0.04 + 2 * noise(position) ** 2.4;
          const corner = cornerX < 7 && cornerY < 7 ? 1.7 : 1;
          const distance = Math.min(Math.abs(position - band), 1 - Math.abs(position - band));
          const glow = energy * Math.exp(-((distance / 0.07) ** 2));
          const density = falloff[depth] * gather * corner * (1 + 0.6 * energy + 3 * glow + pulse * 1.4);
          const salt = glow > 0.04 || pulse > 0.04 ? twinkle : 0;
          if (hash(x, y, seed + salt) >= density) continue;

          const pick = hash(y, x, seed * 3 + salt);
          const accent = 0.1 + 0.3 * glow;
          if (pick < accent) {
            context!.fillStyle = pick < accent * 0.68 ? colors.cool : colors.warm;
            context!.globalAlpha = Math.min(0.7 + 0.3 * glow, 1);
          } else {
            context!.fillStyle = colors.ink;
            context!.globalAlpha = Math.min((0.14 + 0.2 * (1 - depth / falloff.length)) * (1 + 1.2 * glow + pulse * 0.5), 0.85);
          }
          context!.fillRect(offsetX + x * pitch + inset, offsetY + y * pitch + inset, size, size);
        }
      }
      context!.globalAlpha = 1;
    }

    function tick(now: number) {
      frame = 0;
      if (!onScreen || document.hidden || reducedMotion.matches) return;
      const elapsed = Math.min(now - last, 64);
      last = now;
      energy += (target - energy) * (1 - Math.exp(-elapsed / (target > energy ? 120 : 220)));
      pulse *= Math.exp(-elapsed / 160);
      time += elapsed * (0.35 + 0.65 * energy);
      if (now - drawn >= frameTime) { drawn = now; draw(); }
      if (target === 0 && energy < 0.003 && pulse < 0.01) {
        energy = 0; pulse = 0;
        draw();
        return;
      }
      frame = requestAnimationFrame(tick);
    }

    function wake() {
      if (reducedMotion.matches) {
        cancelAnimationFrame(frame);
        frame = 0; energy = 0; pulse = 0;
        draw();
        return;
      }
      if (!frame && onScreen && !document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    }

    function measure() {
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      if (!width || !height) return;
      ratio = Math.min(devicePixelRatio || 1, 3);
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      draw();
      canvas!.dataset.ready = "";
    }

    function recolor() { readColors(); draw(); }
    function activate() { target = 1; wake(); }
    function deactivate(event: Event) {
      // A finger leaves no hover behind, so touch ends the effect even while :hover still matches.
      const touch = event instanceof PointerEvent && event.pointerType !== "mouse";
      if (!touch && (element!.matches(":hover") || element!.matches(":focus-visible"))) return;
      target = 0;
      wake();
    }
    function press() { pulse = 1; wake(); }
    function focus() { if (element!.matches(":focus-visible")) activate(); }

    readColors();
    const resize = new ResizeObserver(measure);
    const visibility = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; if (target || energy) wake(); });
    const theme = new MutationObserver(recolor);
    resize.observe(canvas);
    visibility.observe(element);
    theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    darkScheme.addEventListener("change", recolor);
    element.addEventListener("pointerenter", activate);
    element.addEventListener("pointerleave", deactivate);
    element.addEventListener("pointerdown", press);
    element.addEventListener("focus", focus);
    element.addEventListener("blur", deactivate);
    document.addEventListener("visibilitychange", wake);
    reducedMotion.addEventListener("change", wake);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      theme.disconnect();
      darkScheme.removeEventListener("change", recolor);
      element.removeEventListener("pointerenter", activate);
      element.removeEventListener("pointerleave", deactivate);
      element.removeEventListener("pointerdown", press);
      element.removeEventListener("focus", focus);
      element.removeEventListener("blur", deactivate);
      document.removeEventListener("visibilitychange", wake);
      reducedMotion.removeEventListener("change", wake);
    };
  }, [children]);

  return (
    <Link href={href} className={cn(primaryButton, "relative isolate overflow-hidden active:scale-[0.98] motion-reduce:active:scale-100", className)}>
      <canvas ref={canvasRef} aria-hidden="true"
        className="pixel-edge pointer-events-none absolute inset-0 -z-10 size-full opacity-0 transition-opacity duration-500 data-ready:opacity-100 motion-reduce:transition-none forced-colors:hidden" />
      {children}
    </Link>
  );
}
