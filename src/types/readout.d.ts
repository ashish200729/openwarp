declare module "#openwarp-readout" {
  import type { ComponentProps, ComponentType } from "react";

  export const Readout: ComponentType<ComponentProps<"canvas"> & {
    accentColor?: string;
    color?: string;
    fps?: number;
    level?: number;
    smoke?: number;
    waveHeight?: number;
  }>;
}
