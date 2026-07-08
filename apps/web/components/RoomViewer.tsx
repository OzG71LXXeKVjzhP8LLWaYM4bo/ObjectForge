"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchHotspots } from "@/lib/api";
import type { Hotspot, SceneResult } from "@/lib/sceneTypes";
import { HotspotOverlay } from "./HotspotOverlay";
import { PointCloudViewer } from "./PointCloudViewer";
import { SplatViewer } from "./SplatViewer";

export function RoomViewer({ scene }: { scene?: SceneResult }) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [activeHotspot, setActiveHotspot] = useState<Hotspot | undefined>();
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    fetchHotspots(scene?.assets.hotspotsJsonUrl).then((payload) => {
      setHotspots(payload.hotspots);
      setActiveHotspot(undefined);
    });
  }, [scene?.assets.hotspotsJsonUrl]);

  const showSplat = scene?.visualMode === "splat" && scene.assets.splatUrl;

  return (
    <section className="relative h-full min-h-[420px] overflow-hidden bg-ink">
      {showSplat ? (
        <SplatViewer url={scene.assets.splatUrl} />
      ) : (
        <PointCloudViewer
          key={resetKey}
          url={scene?.assets.pointcloudUrl}
          glbUrl={scene?.assets.pointcloudGlbUrl}
          activeHotspot={activeHotspot}
        />
      )}

      <HotspotOverlay hotspots={hotspots} onSelect={setActiveHotspot} />

      <button
        type="button"
        onClick={() => setResetKey((value) => value + 1)}
        className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded border border-white/60 bg-white px-3 py-2 text-xs font-medium text-ink shadow"
      >
        <RotateCcw size={16} />
        Reset camera
      </button>
    </section>
  );
}
