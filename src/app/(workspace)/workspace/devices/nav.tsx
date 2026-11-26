import { SubNav } from "@/components/workspace/workplace-parts";

export function DevicesNav({ current, admin, waiting = 0 }: { current: "devices" | "apps"; admin: boolean; waiting?: number }) {
  return <SubNav label="Devices and apps" current={current === "apps" ? "/workspace/devices/apps" : "/workspace/devices"} links={[{ href: "/workspace/devices", label: admin ? "Devices" : "My devices" }, { href: "/workspace/devices/apps", label: "App access", count: waiting }]} />;
}
