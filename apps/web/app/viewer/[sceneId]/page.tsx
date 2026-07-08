"use client";

import { useEffect, useState } from "react";
import { getScene } from "@/lib/api";
import type { SceneResult } from "@/lib/sceneTypes";
import { FloorplanPanel } from "@/components/FloorplanPanel";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { RoomViewer } from "@/components/RoomViewer";
import { SceneInfoPanel } from "@/components/SceneInfoPanel";

type Props = {
  params: Promise<{ sceneId: string }>;
};

export default function ViewerPage({ params }: Props) {
  const [sceneId, setSceneId] = useState<string>();
  const [scene, setScene] = useState<SceneResult>();

  useEffect(() => {
    params.then(({ sceneId: nextSceneId }) => setSceneId(nextSceneId));
  }, [params]);

  useEffect(() => {
    if (!sceneId) return;

    let cancelled = false;

    async function load() {
      const nextScene = await getScene(sceneId!);
      if (!cancelled) setScene(nextScene);
    }

    load();
    const timer = window.setInterval(load, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sceneId]);

  return (
    <main className="viewer-grid">
      <RoomViewer scene={scene} />
      <div className="grid border-t border-line md:grid-cols-[1fr_360px]">
        <FloorplanPanel scene={scene} />
        <div className="grid border-l border-line md:grid-cols-1">
          <ProcessingStatus scene={scene} />
          <SceneInfoPanel scene={scene} />
        </div>
      </div>
    </main>
  );
}
