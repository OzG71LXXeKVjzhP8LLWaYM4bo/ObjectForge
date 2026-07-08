"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getScene, startSceneProcessing, uploadSceneVideo } from "@/lib/api";
import type { SceneResult } from "@/lib/sceneTypes";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { RoomViewer } from "@/components/RoomViewer";
import { VideoUpload } from "@/components/VideoUpload";

const captureTips = [
  "record one room at a time",
  "move slowly",
  "avoid motion blur",
  "capture all corners",
  "start near the doorway",
  "do a slow pan from the centre",
  "avoid mirrors/glass when possible",
  "keep the phone level",
  "use good lighting"
];

export default function HomePage() {
  const router = useRouter();
  const [scene, setScene] = useState<SceneResult>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!scene || scene.status !== "processing") return;

    const timer = window.setInterval(async () => {
      const nextScene = await getScene(scene.sceneId);
      setScene(nextScene);
      if (nextScene.status === "done") {
        window.clearInterval(timer);
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [scene]);

  async function handleUpload(file: File) {
    setBusy(true);
    setMessage("Uploading video...");

    try {
      const uploaded = await uploadSceneVideo(file);
      setScene(uploaded);
      setMessage("Starting Modal processing...");
      const processing = await startSceneProcessing(uploaded.sceneId);
      setScene(processing);
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 p-4 md:p-6">
      <VideoUpload disabled={busy} onUpload={handleUpload} />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="overflow-hidden rounded border border-line bg-white shadow-sm">
          <div className="h-[460px]">
            <RoomViewer scene={scene} />
          </div>
          {scene?.status === "done" ? (
            <div className="border-t border-line p-3 text-right">
              <button
                type="button"
                onClick={() => router.push(`/viewer/${scene.sceneId}`)}
                className="rounded border border-ink bg-ink px-4 py-2 text-sm font-medium text-white"
              >
                Open full viewer
              </button>
            </div>
          ) : null}
        </section>

        <div className="flex flex-col gap-5">
          <ProcessingStatus scene={scene} message={message} />
          <section className="rounded border border-line bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
              Capture Tips
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-neutral-700">
              {captureTips.map((tip) => (
                <li key={tip}>- {tip}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
