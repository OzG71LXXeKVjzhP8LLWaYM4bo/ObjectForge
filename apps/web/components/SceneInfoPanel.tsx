import { Box, Info } from "lucide-react";
import type { SceneResult } from "@/lib/sceneTypes";

export function SceneInfoPanel({ scene }: { scene?: SceneResult }) {
  return (
    <aside className="h-full border-l border-line bg-white p-4">
      <div className="flex items-center gap-2">
        <Info size={18} />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Scene
        </h2>
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-neutral-500">ID</dt>
          <dd className="break-all font-mono text-xs">{scene?.sceneId ?? "none"}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Status</dt>
          <dd>{scene?.status ?? "idle"}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Visual mode</dt>
          <dd className="inline-flex items-center gap-2">
            <Box size={16} />
            {scene?.visualMode ?? "pending"}
          </dd>
        </div>
      </dl>

      <p className="mt-5 text-sm leading-6 text-neutral-700">
        Splat quality improves with slower camera motion, full corner coverage,
        level framing, and consistent lighting.
      </p>

      {scene?.assets.pointcloudUrl || scene?.assets.pointcloudGlbUrl ? (
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          {scene.assets.pointcloudUrl ? (
            <a
              href={scene.assets.pointcloudUrl}
              className="rounded border border-line px-2 py-1 text-neutral-700"
            >
              PLY
            </a>
          ) : null}
          {scene.assets.pointcloudGlbUrl ? (
            <a
              href={scene.assets.pointcloudGlbUrl}
              className="rounded border border-line px-2 py-1 text-neutral-700"
            >
              GLB
            </a>
          ) : null}
        </div>
      ) : null}

      {scene?.assets.depthPreviewUrl || scene?.assets.confidencePreviewUrl ? (
        <div className="mt-5 grid grid-cols-2 gap-3">
          {scene.assets.depthPreviewUrl ? (
            <PreviewImage label="Depth" src={scene.assets.depthPreviewUrl} />
          ) : null}
          {scene.assets.confidencePreviewUrl ? (
            <PreviewImage label="Confidence" src={scene.assets.confidencePreviewUrl} />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function PreviewImage({ label, src }: { label: string; src: string }) {
  return (
    <figure>
      <div className="aspect-square overflow-hidden rounded border border-line bg-neutral-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${label} preview`} className="h-full w-full object-cover" />
      </div>
      <figcaption className="mt-1 text-xs text-neutral-500">{label}</figcaption>
    </figure>
  );
}
