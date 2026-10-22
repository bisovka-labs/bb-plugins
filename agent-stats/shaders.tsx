// Shader themes: a Paper Shaders background (WebGL, animated) under the card's type. Every theme shares the
// shader layout in card.tsx; a theme only picks its shader, its parameters and the ink the type wears on it.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Dithering, GrainGradient, MeshGradient, NeuroNoise, Swirl, Warp } from "@paper-design/shaders-react";

export type ShaderTheme = "sunset" | "grain" | "pixels" | "acid" | "neural" | "swirl";
export type ShaderInk = { fg: string; muted: string; glass: string; line: string };

// Keep the buffer available to image and video exports.
const background = (width: number, height: number, moving: boolean) => ({
  speed: moving ? 0.35 : 0,
  frame: 6000,
  webGlContextAttributes: { preserveDrawingBuffer: true },
  style: { position: "absolute", inset: 0, width, height } as CSSProperties,
});

export const SHADER_THEMES: Record<ShaderTheme, { name: string; ink: ShaderInk; draw: (w: number, h: number, moving: boolean) => ReactNode }> = {
  sunset: {
    name: "Закат",
    ink: { fg: "#ffffff", muted: "rgba(255,255,255,0.74)", glass: "rgba(255,255,255,0.13)", line: "rgba(255,255,255,0.3)" },
    draw: (w, h, moving) => <MeshGradient {...background(w, h, moving)} colors={["#12051f", "#ff7a18", "#d6409f", "#3b1d8f", "#ffb36b"]} distortion={0.9} swirl={0.55} grainOverlay={0.18} />,
  },
  grain: {
    name: "Зерно",
    ink: { fg: "#ffffff", muted: "rgba(255,255,255,0.72)", glass: "rgba(0,0,0,0.4)", line: "rgba(255,255,255,0.2)" },
    draw: (w, h, moving) => <GrainGradient {...background(w, h, moving)} colorBack="#0a0a0a" colors={["#ff8a00", "#ff3d77", "#2a8bd8"]} softness={0.7} intensity={0.45} noise={0.4} shape="blob" scale={0.55} offsetX={0.3} offsetY={0.16} />,
  },
  pixels: {
    name: "Пиксели",
    ink: { fg: "#ffffff", muted: "#ffb46b", glass: "rgba(0,0,0,0.62)", line: "rgba(255,138,0,0.45)" },
    draw: (w, h, moving) => <Dithering {...background(w, h, moving)} colorBack="#000000" colorFront="#ff8a00" shape="sphere" type="4x4" size={3} scale={0.5} offsetX={0.32} offsetY={0.16} />,
  },
  acid: {
    name: "Кислота",
    ink: { fg: "#0a0a0a", muted: "rgba(10,10,10,0.66)", glass: "rgba(255,255,255,0.38)", line: "rgba(10,10,10,0.22)" },
    draw: (w, h, moving) => <Warp {...background(w, h, moving)} colors={["#e8ff6a", "#c4f400", "#9fe000", "#f2ffb0"]} proportion={0.45} softness={1} shape="edge" shapeScale={0.2} distortion={0.3} swirl={0.8} swirlIterations={8} />,
  },
  neural: {
    name: "Нейросеть",
    ink: { fg: "#ffffff", muted: "rgba(200,225,255,0.78)", glass: "rgba(4,5,13,0.55)", line: "rgba(159,228,255,0.3)" },
    draw: (w, h, moving) => <NeuroNoise {...background(w, h, moving)} colorFront="#9fe4ff" colorMid="#2a5bff" colorBack="#04050d" brightness={0.08} contrast={0.35} scale={1.4} />,
  },
  swirl: {
    name: "Воронка",
    ink: { fg: "#120a06", muted: "rgba(18,10,6,0.66)", glass: "rgba(255,255,255,0.58)", line: "rgba(18,10,6,0.18)" },
    draw: (w, h, moving) => <Swirl {...background(w, h, moving)} colorBack="#fff1e4" colors={["#ff6a3d", "#ffb347", "#ff3d77", "#fff1e4"]} bandCount={4} twist={0.35} softness={1} noise={0.15} noiseFrequency={0.3} scale={1.6} />,
  },
};

export const isShaderTheme = (t: string): t is ShaderTheme => t in SHADER_THEMES;

export function ShaderBackground({ theme, width, height, animated, recording }: {
  theme: ShaderTheme; width: number; height: number; animated: boolean; recording: boolean;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let intersecting = false;
    const visibility = () => setVisible(intersecting && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; visibility(); });
    if (node.current) observer.observe(node.current);
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return <div ref={node} aria-hidden style={{ position: "absolute", inset: 0 }}>
    {SHADER_THEMES[theme].draw(width, height, animated && (visible || recording))}
  </div>;
}
