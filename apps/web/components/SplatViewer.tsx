"use client";

import { OrbitControls, Splat } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

export function SplatViewer({ url }: { url?: string }) {
  if (!url) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-ink p-6 text-white">
        <p className="text-sm text-neutral-300">No splat asset available.</p>
      </div>
    );
  }

  return (
    <Canvas camera={{ position: [0, 1.4, 4], fov: 58 }} dpr={[1, 2]}>
      <color attach="background" args={["#15171a"]} />
      <ambientLight intensity={0.8} />
      <Splat src={url} />
      <OrbitControls target={[0, 1.2, 0]} maxPolarAngle={Math.PI * 0.62} />
    </Canvas>
  );
}
