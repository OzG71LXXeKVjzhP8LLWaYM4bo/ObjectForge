"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { generateSceneSplat } from "@/lib/api";
import type { SceneResult } from "@/lib/sceneTypes";

type Props = {
  scene?: SceneResult;
  onSceneChange: (scene: SceneResult) => void;
  getToken?: () => Promise<string | null>;
};

export function SplatGenerationAction({ scene, onSceneChange, getToken }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  if (!scene || scene.status !== "done" || scene.assets.splatUrl) {
    return null;
  }

  async function handleGenerate() {
    if (!scene) return;
    setLoading(true);
    setError(undefined);

    try {
      const token = getToken ? await getToken() : undefined;
      const nextScene = await generateSceneSplat(scene.sceneId, token);
      onSceneChange(nextScene);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Splat generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="inline-flex h-10 items-center gap-2 border border-teal-300 bg-teal-300 px-4 text-sm font-semibold text-obsidian disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
        {loading ? "Generating splat..." : "Generate splat"}
      </button>
    </div>
  );
}
