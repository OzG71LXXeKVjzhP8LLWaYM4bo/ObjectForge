"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

export function ObjectHeroScene() {
  return (
    <Canvas camera={{ position: [0, 0.7, 4.2], fov: 48 }} dpr={[1, 2]}>
      <color attach="background" args={["#0f1214"]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 4, 2]} intensity={1.2} />
      <PointArtifact />
      <Grid />
      <OrbitControls
        autoRotate
        autoRotateSpeed={0.65}
        enablePan={false}
        enableZoom={false}
        target={[0, 0.4, 0]}
        maxPolarAngle={Math.PI * 0.62}
        minPolarAngle={Math.PI * 0.32}
      />
    </Canvas>
  );
}

function PointArtifact() {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();

    for (let i = 0; i < 5200; i += 1) {
      const t = Math.random() * Math.PI * 2;
      const y = -1.05 + Math.random() * 2.25;
      const radius = 0.42 + Math.sin((y + 1.1) * 2.5) * 0.2 + Math.random() * 0.08;
      const neck = y > 0.55 ? 0.46 : 1;
      const shoulder = y > 0.1 && y < 0.7 ? 1.25 : 1;
      const x = Math.cos(t) * radius * neck * shoulder;
      const z = Math.sin(t) * radius * neck * shoulder;
      positions.push(x, y, z);
      color.setHSL(0.48 + Math.random() * 0.1, 0.72, 0.5 + Math.random() * 0.24);
      colors.push(color.r, color.g, color.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, []);

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.019} vertexColors transparent opacity={0.92} />
    </points>
  );
}

function Grid() {
  return <gridHelper args={[4.5, 18, "#2b7f74", "#273034"]} position={[0, -1.12, 0]} />;
}
