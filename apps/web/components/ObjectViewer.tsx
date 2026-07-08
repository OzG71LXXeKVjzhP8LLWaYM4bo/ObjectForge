"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchHotspots } from "@/lib/api";
import type { Hotspot, SceneResult } from "@/lib/sceneTypes";
import { HotspotOverlay } from "./HotspotOverlay";
import { PointCloudViewer } from "./PointCloudViewer";
import { SplatViewer } from "./SplatViewer";

type ViewMode = "splat" | "pointcloud";

export function ObjectViewer({ scene }: { scene?: SceneResult }) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [activeHotspot, setActiveHotspot] = useState<Hotspot | undefined>();
  const [resetKey, setResetKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("pointcloud");

  useEffect(() => {
    fetchHotspots(scene?.assets.hotspotsJsonUrl).then((payload) => {
      setHotspots(payload.hotspots);
      setActiveHotspot(undefined);
    });
  }, [scene?.assets.hotspotsJsonUrl]);

  useEffect(() => {
    setViewMode(scene?.assets.splatUrl ? "splat" : "pointcloud");
  }, [scene?.sceneId, scene?.assets.splatUrl]);

  const hasSplat = Boolean(scene?.assets.splatUrl);
  const hasPointCloud = Boolean(scene?.assets.pointcloudUrl || scene?.assets.pointcloudGlbUrl);
  const showSplat = hasSplat && viewMode === "splat";

  return (
    <section className="relative h-full min-h-[420px] overflow-hidden bg-ink">
      {showSplat ? (
        <SplatViewer key={resetKey} url={scene?.assets.splatUrl} />
      ) : (
        <PointCloudViewer
          key={resetKey}
          url={scene?.assets.pointcloudUrl}
          glbUrl={scene?.assets.pointcloudGlbUrl}
          activeHotspot={activeHotspot}
        />
      )}

      <HotspotOverlay hotspots={hotspots} onSelect={setActiveHotspot} />

      {hasSplat && hasPointCloud ? (
        <div className="absolute left-4 top-4 inline-flex overflow-hidden border border-white/40 bg-obsidian/88 text-xs font-medium text-white shadow">
          <button
            type="button"
            onClick={() => setViewMode("splat")}
            className={`px-3 py-2 ${viewMode === "splat" ? "bg-white text-ink" : "text-white"}`}
          >
            Splat
          </button>
          <button
            type="button"
            onClick={() => setViewMode("pointcloud")}
            className={`px-3 py-2 ${viewMode === "pointcloud" ? "bg-white text-ink" : "text-white"}`}
          >
            Point cloud
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setResetKey((value) => value + 1)}
        className="absolute bottom-4 right-4 inline-flex items-center gap-2 border border-white/60 bg-white px-3 py-2 text-xs font-medium text-obsidian shadow"
      >
        <RotateCcw size={16} />
        Reset camera
      </button>
    </section>
  );
}
