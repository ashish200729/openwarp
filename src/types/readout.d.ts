declare module "#openwarp-readout" {
  import type { ComponentProps, ComponentType } from "react";

  export const Readout: ComponentType<Omit<ComponentProps<"canvas">, "color"> & {
    accentColor?: string;
    color?: string;
    dotSize?: number;
    fps?: number;
    level?: number;
    smoke?: number;
    speed?: number;
    strength?: number;
    waveHeight?: number;
  }>;
}
