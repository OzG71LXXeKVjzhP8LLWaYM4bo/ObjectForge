import type { SceneResult } from "@/lib/sceneTypes";

export function FloorplanPanel({ scene }: { scene?: SceneResult }) {
  const floorplan = scene?.assets.floorplanSvgUrl ?? scene?.assets.floorplanPngUrl;

  return (
    <section className="h-full bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Capture Footprint
        </h2>
        <span className="border border-line bg-white px-2 py-1 text-xs text-neutral-600">
          MVP estimate
        </span>
      </div>

      <div className="flex h-[210px] items-center justify-center overflow-hidden border border-line bg-white">
        {floorplan ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={floorplan} alt="Approximate generated capture footprint" className="h-full w-full object-contain" />
        ) : (
          <div className="text-sm text-neutral-500">Capture footprint will appear after processing.</div>
        )}
      </div>
    </section>
  );
}
