"use client";

import { ExternalLink } from "lucide-react";

export function SplatViewer({ url }: { url?: string }) {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center bg-ink p-6 text-white">
      <div className="max-w-md text-center">
        <h2 className="text-xl font-semibold">Gaussian splat asset ready</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-300">
          The MVP keeps splat rendering behind an integration boundary so the
          point-cloud route remains reliable. Open this exported asset in a
          compatible splat viewer while browser rendering is finalized.
        </p>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded border border-white px-4 py-2 text-sm font-medium"
          >
            <ExternalLink size={17} />
            Open splat
          </a>
        ) : null}
      </div>
    </div>
  );
}
