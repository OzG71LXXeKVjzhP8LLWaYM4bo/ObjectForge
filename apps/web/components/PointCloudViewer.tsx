"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { Hotspot } from "@/lib/sceneTypes";

type Props = {
  url?: string;
  glbUrl?: string;
  activeHotspot?: Hotspot;
};

type RenderSource = "ply" | "glb";
type UpAxis = "y" | "z" | "x";

export function PointCloudViewer({ url, glbUrl, activeHotspot }: Props) {
  const [source, setSource] = useState<RenderSource>("ply");
  const [confidence, setConfidence] = useState(50);
  const [frame, setFrame] = useState<number | "all">("all");
  const [upAxis, setUpAxis] = useState<UpAxis>("z");
  const showGlb = source === "glb" && glbUrl;

  return (
    <div className="relative h-full">
      <Canvas camera={{ position: [0, 1.6, 4], fov: 58 }} dpr={[1, 2]}>
        <color attach="background" args={["#0f1214"]} />
        <ambientLight intensity={0.8} />
        <gridHelper args={[10, 20, "#58605c", "#363b38"]} position={[0, 0, 0]} />
        {showGlb ? (
          <PointCloudGlb url={glbUrl} upAxis={upAxis} />
        ) : url ? (
          <PointCloud url={url} confidence={confidence} frame={frame} upAxis={upAxis} />
        ) : (
          <PlaceholderObject />
        )}
        <CameraHotspotSync hotspot={activeHotspot} />
        <OrbitControls target={[0, 1.2, 0]} maxPolarAngle={Math.PI * 0.52} />
      </Canvas>

      {url ? (
        <div className="absolute bottom-4 left-4 flex max-w-[calc(100%-7rem)] flex-wrap items-center gap-3 border border-white/20 bg-obsidian/88 px-3 py-2 text-xs text-white shadow">
          {glbUrl ? (
            <div className="inline-flex overflow-hidden border border-white/30">
              <button
                type="button"
                onClick={() => setSource("ply")}
                className={`px-3 py-1 ${source === "ply" ? "bg-white text-ink" : "text-white"}`}
              >
                PLY
              </button>
              <button
                type="button"
                onClick={() => setSource("glb")}
                className={`px-3 py-1 ${source === "glb" ? "bg-white text-ink" : "text-white"}`}
              >
                GLB
              </button>
            </div>
          ) : null}
          <label className="inline-flex items-center gap-2">
            <span>Confidence</span>
            <input
              type="range"
              min="0"
              max="95"
              step="5"
              value={confidence}
              disabled={source === "glb"}
              onChange={(event) => setConfidence(Number(event.target.value))}
              className="w-28 disabled:opacity-40"
            />
            <span className="tabular-nums">{confidence}%</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <span>Frame</span>
            <input
              type="number"
              min="0"
              value={frame === "all" ? "" : frame}
              disabled={source === "glb"}
              onChange={(event) => {
                const value = event.target.value;
                setFrame(value === "" ? "all" : Number(value));
              }}
              placeholder="All"
              className="h-7 w-16 border border-white/30 bg-transparent px-2 text-white placeholder:text-white/70 disabled:opacity-40"
            />
          </label>
          <div className="inline-flex items-center overflow-hidden border border-white/30">
            {(["y", "z", "x"] as const).map((axis) => (
              <button
                key={axis}
                type="button"
                onClick={() => setUpAxis(axis)}
                className={`px-3 py-1 uppercase ${upAxis === axis ? "bg-white text-ink" : "text-white"}`}
              >
                {axis}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PointCloud({
  url,
  confidence,
  frame,
  upAxis
}: {
  url: string;
  confidence: number;
  frame: number | "all";
  upAxis: UpAxis;
}) {
  const geometry = useLoader(PLYLoader, url, (loader) => {
    loader.setCustomPropertyNameMapping({
      confidence: ["confidence"],
      frame: ["frame"]
    });
  });

  const filteredGeometry = useMemo(
    () => filterPointGeometry(geometry, confidence, frame, upAxis),
    [geometry, confidence, frame, upAxis]
  );

  const points = useMemo(() => {
    filteredGeometry.computeBoundingSphere();
    const material = new THREE.PointsMaterial({
      size: 0.025,
      vertexColors: Boolean(filteredGeometry.getAttribute("color")),
      color: filteredGeometry.getAttribute("color") ? undefined : new THREE.Color("#d9d2c3")
    });

    return new THREE.Points(filteredGeometry, material);
  }, [filteredGeometry]);

  return <primitive object={points} />;
}

function PointCloudGlb({ url, upAxis }: { url: string; upAxis: UpAxis }) {
  const gltf = useLoader(GLTFLoader, url);
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.rotation.copy(rotationForUpAxis(upAxis));
    clone.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(clone);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      clone.position.set(-center.x, -box.min.y, -center.z);
    }
    return clone;
  }, [gltf.scene, upAxis]);

  return <primitive object={scene} />;
}

function filterPointGeometry(
  source: THREE.BufferGeometry,
  confidencePercentile: number,
  frame: number | "all",
  upAxis: UpAxis
) {
  const position = source.getAttribute("position");
  const color = source.getAttribute("color");
  const confidence = source.getAttribute("confidence");
  const frameAttribute = source.getAttribute("frame");

  if (!position) return source;

  const confidenceValues: number[] = [];
  if (confidence) {
    for (let i = 0; i < confidence.count; i += 1) {
      confidenceValues.push(confidence.getX(i));
    }
  }
  confidenceValues.sort((a, b) => a - b);
  const thresholdIndex = Math.min(
    confidenceValues.length - 1,
    Math.max(0, Math.round((confidencePercentile / 100) * (confidenceValues.length - 1)))
  );
  const threshold = confidenceValues.length ? confidenceValues[thresholdIndex] : 0;

  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    if (confidence && confidence.getX(i) < threshold) continue;
    if (frame !== "all" && frameAttribute && Math.round(frameAttribute.getX(i)) !== frame) continue;

    positions.push(position.getX(i), position.getY(i), position.getZ(i));
    if (color) {
      colors.push(color.getX(i), color.getY(i), color.getZ(i));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (colors.length) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  geometry.applyMatrix4(matrixForUpAxis(upAxis));
  centerGeometryOnFloor(geometry);
  return geometry;
}

function rotationForUpAxis(upAxis: UpAxis) {
  switch (upAxis) {
    case "z":
      return new THREE.Euler(-Math.PI / 2, 0, 0);
    case "x":
      return new THREE.Euler(0, 0, Math.PI / 2);
    case "y":
      return new THREE.Euler(0, 0, 0);
  }
}

function matrixForUpAxis(upAxis: UpAxis) {
  return new THREE.Matrix4().makeRotationFromEuler(rotationForUpAxis(upAxis));
}

function centerGeometryOnFloor(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);
}

function PlaceholderObject() {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();

    for (let i = 0; i < 3600; i += 1) {
      const t = Math.random() * Math.PI * 2;
      const y = -0.9 + Math.random() * 1.9;
      const radius = 0.34 + Math.sin((y + 0.85) * 3) * 0.16 + Math.random() * 0.09;
      const x = Math.cos(t) * radius * (y > 0.45 ? 0.55 : 1);
      const z = Math.sin(t) * radius * (y > 0.45 ? 0.55 : 1);
      positions.push(x, y, z);
      color.setHSL(0.47 + Math.random() * 0.12, 0.65, 0.48 + Math.random() * 0.22);
      colors.push(color.r, color.g, color.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, []);

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.035} vertexColors />
    </points>
  );
}

function CameraHotspotSync({ hotspot }: { hotspot?: Hotspot }) {
  const { camera } = useThree();

  useEffect(() => {
    if (!hotspot) return;
    camera.position.set(...hotspot.position);
    camera.lookAt(new THREE.Vector3(...hotspot.lookAt));
  }, [camera, hotspot]);

  return null;
}
