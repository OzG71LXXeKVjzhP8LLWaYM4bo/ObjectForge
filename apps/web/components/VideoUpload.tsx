"use client";

import { Camera, Upload } from "lucide-react";
import { useRef, useState } from "react";

type Props = {
  disabled?: boolean;
  onUpload: (file: File) => void;
};

export function VideoUpload({ disabled, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");

  return (
    <section className="border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 border border-teal-700/25 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">
            <Camera size={14} />
            Object capture
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Create a 3D object reconstruction</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-700">
            Upload a short orbit capture of a single object. ObjectForge builds inspectable scene
            assets from the clip and shows reconstruction progress as it runs.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-11 items-center justify-center gap-2 border border-obsidian bg-obsidian px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload size={18} />
          Upload capture
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setFileName(file.name);
          onUpload(file);
        }}
      />

      {fileName ? (
        <p className="mt-4 border-t border-line pt-4 text-sm text-neutral-700">Selected: {fileName}</p>
      ) : null}
    </section>
  );
}
