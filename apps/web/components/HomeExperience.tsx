"use client";

import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { ArrowRight, Camera, Cuboid, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { ObjectViewer } from "@/components/ObjectViewer";
import { VideoUpload } from "@/components/VideoUpload";
import { getScene, startSceneProcessing, uploadSceneVideo } from "@/lib/api";
import type { SceneResult } from "@/lib/sceneTypes";

const captureTips = [
  "Capture one object at a time",
  "Orbit the object slowly",
  "Keep the whole object in frame",
  "Use soft, even lighting",
  "Avoid glossy or transparent surfaces",
  "Film multiple height angles",
  "Place the object on a textured surface",
  "Pause briefly at each quarter turn"
];

export default function HomePage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <ClerkSetupPage />;
  }

  return (
    <>
      <SignedOut>
        <LandingPage />
      </SignedOut>
      <SignedIn>
        <CaptureWorkspace />
      </SignedIn>
    </>
  );
}

function ClerkSetupPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f5ef] p-6 text-obsidian">
      <section className="w-full max-w-xl border border-line bg-white p-6 shadow-sm">
        <div className="mb-5 inline-flex items-center gap-2 border border-teal-700/25 bg-teal-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">
          <Shield size={15} />
          Clerk setup required
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">ObjectForge</h1>
        <p className="mt-4 text-sm leading-6 text-neutral-700">
          Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to enable uploads.
        </p>
      </section>
    </main>
  );
}

function LandingPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f5ef] p-6 text-obsidian">
      <section className="w-full max-w-md border border-line bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center border border-obsidian bg-obsidian text-white">
            <Cuboid size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">ObjectForge</h1>
            <p className="text-xs text-neutral-600">Object capture workspace</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <SignInButton mode="modal">
            <button className="inline-flex h-10 items-center border border-obsidian bg-obsidian px-4 text-sm font-semibold text-white">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="inline-flex h-10 items-center gap-2 border border-line bg-white px-4 text-sm font-semibold text-obsidian">
              Create account
              <ArrowRight size={16} />
            </button>
          </SignUpButton>
        </div>
      </section>
    </main>
  );
}

function CaptureWorkspace() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [scene, setScene] = useState<SceneResult>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!scene || scene.status !== "processing") return;

    const timer = window.setInterval(async () => {
      const token = await getToken();
      const nextScene = await getScene(scene.sceneId, token);
      setScene(nextScene);
      if (nextScene.status === "done") {
        window.clearInterval(timer);
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [getToken, scene]);

  async function handleUpload(file: File) {
    setBusy(true);
    setMessage("Uploading capture...");

    try {
      const token = await getToken();
      const uploaded = await uploadSceneVideo(file, token);
      setScene(uploaded);
      setMessage("Starting reconstruction...");
      const processing = await startSceneProcessing(uploaded.sceneId, token);
      setScene(processing);
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f5ef] text-obsidian">
      <header className="border-b border-line bg-white/92 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center border border-obsidian bg-obsidian text-white">
              <Cuboid size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em]">ObjectForge</p>
              <p className="text-xs text-neutral-600">Capture console</p>
            </div>
          </div>
          <UserButton />
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <section className="min-w-0">
          <div className="overflow-hidden border border-line bg-obsidian shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200">
                  Scene preview
                </p>
                <p className="mt-1 text-sm text-white/65">
                  Upload a capture to inspect the generated object reconstruction here.
                </p>
              </div>
              {scene?.status ? (
                <span className="border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/80">
                  {scene.status}
                </span>
              ) : null}
            </div>
            <div className="h-[540px]">
              <ObjectViewer scene={scene} />
            </div>
            {scene?.status === "done" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-obsidian px-4 py-3">
                <p className="text-sm text-white/70">Object reconstruction is ready for inspection.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => router.push(`/viewer/${scene.sceneId}`)}
                    className="inline-flex h-10 items-center gap-2 border border-white bg-white px-4 text-sm font-semibold text-obsidian"
                  >
                    Open viewer
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <VideoUpload disabled={busy} onUpload={handleUpload} />
          <ProcessingStatus scene={scene} message={message} />
          <section className="border border-line bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Camera className="text-teal-700" size={20} />
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-neutral-700">
                Capture checklist
              </h2>
            </div>
            <ul className="mt-4 grid gap-2 text-sm text-neutral-700">
              {captureTips.map((tip) => (
                <li key={tip} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 bg-teal-700" />
                  {tip}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
