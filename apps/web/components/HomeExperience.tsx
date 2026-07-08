"use client";

import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import { ArrowRight, Box, Camera, Check, Cuboid, FileVideo, Rotate3D, Shield, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectHeroScene } from "@/components/ObjectHeroScene";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { ObjectViewer } from "@/components/ObjectViewer";
import { VideoUpload } from "@/components/VideoUpload";
import { getScene, startSceneProcessing, uploadSceneVideo } from "@/lib/api";
import type { SceneResult } from "@/lib/sceneTypes";
import type { LucideIcon } from "lucide-react";

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

const workflowItems: Array<[LucideIcon, string, string]> = [
  [FileVideo, "Record", "Capture a short pass around one object with a phone or camera."],
  [Upload, "Upload", "Send the clip into the authenticated reconstruction workflow."],
  [Rotate3D, "Reconstruct", "Run the object through the processing pipeline and prepare viewable assets."],
  [Box, "Inspect", "Review the point cloud and generated scene outputs in the browser."]
];

const scopeItems = [
  "Works best with one non-glossy object in steady, even light.",
  "Designed around short capture videos, not room-scale mapping.",
  "Prioritizes point-cloud inspection and clear reconstruction status.",
  "Exports viewable point-cloud assets after reconstruction."
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
    <main className="min-h-screen bg-obsidian text-white">
      <section className="relative min-h-screen overflow-hidden">
        <div className="absolute inset-0">
          <ObjectHeroScene />
        </div>
        <div className="absolute inset-0 bg-obsidian/80" />
        <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl items-center px-4 md:px-6">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 border border-teal-200/30 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-100 backdrop-blur">
              <Shield size={15} />
              Clerk setup required
            </div>
            <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">ObjectForge</h1>
            <p className="mt-6 text-lg leading-8 text-white/75">
              Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `apps/web/.env`
              to enable sign-in, uploads, and the authenticated capture workspace.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f7f5ef] text-obsidian">
      <header className="fixed left-0 right-0 top-0 z-20 border-b border-obsidian/10 bg-[#f7f5ef]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em]">ObjectForge</p>
            <p className="hidden text-xs text-neutral-600 sm:block">Object capture workspace</p>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-neutral-700 md:flex" aria-label="Landing sections">
            <a href="#workflow" className="hover:text-obsidian">
              Workflow
            </a>
            <a href="#scope" className="hover:text-obsidian">
              Scope
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <SignInButton mode="modal">
              <button className="text-sm text-neutral-700 hover:text-obsidian">Sign in</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="inline-flex h-10 items-center gap-2 border border-obsidian bg-obsidian px-4 text-sm font-semibold text-white transition hover:bg-white hover:text-obsidian">
                Try capture
                <ArrowRight size={16} />
              </button>
            </SignUpButton>
          </div>
        </div>
      </header>

      <section className="relative min-h-[92vh] overflow-hidden bg-obsidian pt-16 text-white">
        <div className="absolute inset-y-16 right-0 w-full opacity-55 md:left-[48%] md:w-[52%] md:opacity-100">
          <ObjectHeroScene />
        </div>
        <div className="absolute inset-0 bg-obsidian/70 md:right-[40%]" />

        <div className="relative z-10 mx-auto flex min-h-[calc(92vh-4rem)] max-w-7xl items-center px-4 pb-20 pt-14 md:px-6">
          <div className="max-w-2xl">
            <p className="mb-5 max-w-max border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#9fe0d4] backdrop-blur">
              Phone video to inspectable point cloud
            </p>
            <h1 className="text-5xl font-semibold leading-[1.01] tracking-tight md:text-7xl">
              Turn a short object capture into a 3D scene.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/75 md:text-xl">
              ObjectForge gives teams a clean path from single-object video upload to reconstruction
              status, point-cloud review, and generated scene assets in the browser.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <SignUpButton mode="modal">
                <button className="inline-flex h-12 items-center gap-2 border border-[#9fe0d4] bg-[#9fe0d4] px-5 text-sm font-semibold text-obsidian transition hover:border-white hover:bg-white">
                  Start a scan
                  <ArrowRight size={17} />
                </button>
              </SignUpButton>
              <a
                href="#workflow"
                className="inline-flex h-12 items-center border border-white/25 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur transition hover:border-white hover:bg-white hover:text-obsidian"
              >
                See workflow
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="border-y border-obsidian/10 bg-[#f7f5ef] text-obsidian">
        <div className="mx-auto max-w-7xl px-4 py-20 md:px-6">
          <div className="grid gap-10 md:grid-cols-[0.75fr_1.25fr] md:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#9d4f1d]">Workflow</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl">
                A focused capture path from footage to review.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-neutral-700 md:justify-self-end">
              The signed-in workspace keeps capture, processing, and inspection in one place, with clear
              status feedback while reconstruction runs.
            </p>
          </div>
          <div className="mt-12 grid border-y border-obsidian/10 md:grid-cols-4">
            {workflowItems.map(([Icon, title, body]) => (
              <article key={title} className="border-b border-obsidian/10 py-8 md:border-b-0 md:border-r md:px-6 md:last:border-r-0">
                <Icon className="text-accent" size={23} />
                <h3 className="mt-5 text-xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-neutral-700">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="scope" className="bg-white text-obsidian">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 md:grid-cols-[0.8fr_1.2fr] md:px-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#9d4f1d]">Capture guide</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl">
              Clear capture guidance, visible constraints.
            </h2>
            <p className="mt-5 text-base leading-7 text-neutral-700">
              ObjectForge is direct about what makes a scan readable: a single subject, steady motion,
              even light, and enough surface detail for reconstruction.
            </p>
          </div>
          <div className="grid gap-3">
            {scopeItems.map((item) => (
              <div key={item} className="flex gap-4 border border-line bg-[#f7f5ef] p-5">
                <Check className="mt-0.5 shrink-0 text-[#9d4f1d]" size={19} />
                <p className="text-sm leading-6 text-neutral-700">{item}</p>
              </div>
            ))}
          </div>
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
