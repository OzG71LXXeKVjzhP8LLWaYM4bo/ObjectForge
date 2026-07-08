"use client";

import { AlertTriangle, CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import type { SceneResult } from "@/lib/sceneTypes";

type Props = {
  scene?: SceneResult;
  message?: string;
};

export function ProcessingStatus({ scene, message }: Props) {
  const status = scene?.status;
  const icon =
    status === "done" ? (
      <CheckCircle2 className="text-accent" size={20} />
    ) : status === "failed" ? (
      <AlertTriangle className="text-warn" size={20} />
    ) : status === "processing" ? (
      <Loader2 className="animate-spin text-accent" size={20} />
    ) : (
      <UploadCloud className="text-neutral-600" size={20} />
    );

  return (
    <section className="rounded border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
            Processing
          </h2>
          <p className="mt-1 text-base font-medium">
            {message ?? (status ? statusLabel(status) : "Waiting for upload")}
          </p>
        </div>
      </div>

      {scene?.warnings.length ? (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {scene.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {scene?.error ? (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {scene.error}
        </p>
      ) : null}
    </section>
  );
}

function statusLabel(status: SceneResult["status"]) {
  switch (status) {
    case "uploaded":
      return "Video uploaded. Ready to process.";
    case "processing":
      return "Modal is processing the room.";
    case "done":
      return "Scene is ready.";
    case "failed":
      return "Processing failed.";
  }
}
