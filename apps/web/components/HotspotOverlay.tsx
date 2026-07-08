"use client";

import type { Hotspot } from "@/lib/sceneTypes";

type Props = {
  hotspots: Hotspot[];
  onSelect: (hotspot: Hotspot) => void;
};

export function HotspotOverlay({ hotspots, onSelect }: Props) {
  if (!hotspots.length) return null;

  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap gap-2">
      {hotspots.map((hotspot) => (
        <button
          key={hotspot.id}
          type="button"
          onClick={() => onSelect(hotspot)}
          className="pointer-events-auto rounded border border-white/60 bg-ink/85 px-3 py-2 text-xs font-medium text-white shadow"
        >
          {hotspot.label}
        </button>
      ))}
    </div>
  );
}
