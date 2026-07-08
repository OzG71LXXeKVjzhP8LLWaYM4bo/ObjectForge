import type { SceneResult } from "@/lib/sceneTypes";

export function FloorplanPanel({ scene }: { scene?: SceneResult }) {
  const floorplan = scene?.assets.floorplanSvgUrl ?? scene?.assets.floorplanPngUrl;

  return (
    <section className="h-full bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Approximate Floorplan
        </h2>
        <span className="rounded border border-line bg-white px-2 py-1 text-xs text-neutral-600">
          MVP estimate
        </span>
      </div>

      <div className="flex h-[210px] items-center justify-center overflow-hidden rounded border border-line bg-white">
        {floorplan ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={floorplan} alt="Approximate generated floorplan" className="h-full w-full object-contain" />
        ) : (
          <div className="text-sm text-neutral-500">Floorplan will appear after processing.</div>
        )}
      </div>
    </section>
  );
}
