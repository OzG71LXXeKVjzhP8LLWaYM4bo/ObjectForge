"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import { Cuboid } from "lucide-react";
import { useEffect, useState } from "react";
import { getScene } from "@/lib/api";
import type { SceneResult } from "@/lib/sceneTypes";
import { FloorplanPanel } from "@/components/FloorplanPanel";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { ObjectViewer } from "@/components/ObjectViewer";
import { SceneInfoPanel } from "@/components/SceneInfoPanel";
import { SplatGenerationAction } from "@/components/SplatGenerationAction";

type Props = {
  sceneId: string;
};

export default function ViewerExperience({ sceneId }: Props) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <main className="grid min-h-screen place-items-center bg-porcelain p-6 text-obsidian">
        <section className="max-w-xl border border-line bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Clerk setup required</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-700">
            Add Clerk keys to `apps/web/.env` before opening authenticated reconstruction viewers.
          </p>
        </section>
      </main>
    );
  }

  return <AuthenticatedViewer sceneId={sceneId} />;
}

function AuthenticatedViewer({ sceneId }: Props) {
  const { getToken } = useAuth();
  const [scene, setScene] = useState<SceneResult>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const token = await getToken();
      const nextScene = await getScene(sceneId, token);
      if (!cancelled) setScene(nextScene);
    }

    load();
    const timer = window.setInterval(load, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [getToken, sceneId]);

  return (
    <main className="min-h-screen bg-porcelain text-obsidian">
      <header className="flex h-14 items-center justify-between border-b border-line bg-white px-4">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center border border-obsidian bg-obsidian text-white">
            <Cuboid size={18} />
          </div>
          <span className="text-sm font-semibold uppercase tracking-[0.18em]">ObjectForge Viewer</span>
        </div>
        <UserButton />
      </header>
      <div className="viewer-grid">
        <ObjectViewer scene={scene} />
      </div>
      <div className="grid border-t border-line md:grid-cols-[1fr_360px]">
        <FloorplanPanel scene={scene} />
        <div className="grid border-l border-line md:grid-cols-1">
          <ProcessingStatus scene={scene} />
          <section className="border-t border-line bg-white p-5">
            <SplatGenerationAction scene={scene} onSceneChange={setScene} getToken={getToken} />
          </section>
          <SceneInfoPanel scene={scene} />
        </div>
      </div>
    </main>
  );
}
