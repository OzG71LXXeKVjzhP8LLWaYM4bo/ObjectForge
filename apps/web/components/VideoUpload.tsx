"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";

type Props = {
  disabled?: boolean;
  onUpload: (file: File) => void;
};

export function VideoUpload({ disabled, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");

  return (
    <section className="rounded border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">RoomFly MVP</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-700">
            Upload a short phone video of one room. The demo extracts keyframes,
            builds a point-cloud/floorplan route first, then uses Gaussian splats
            when processing succeeds.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-11 items-center gap-2 rounded border border-ink bg-ink px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload size={18} />
          Upload
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
        <p className="mt-4 text-sm text-neutral-700">Selected: {fileName}</p>
      ) : null}
    </section>
  );
}
