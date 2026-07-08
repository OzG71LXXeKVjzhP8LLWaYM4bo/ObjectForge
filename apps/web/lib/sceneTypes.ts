export type SceneStatus = "uploaded" | "processing" | "done" | "failed";

export type SceneResult = {
  sceneId: string;
  status: SceneStatus;
  visualMode?: "splat" | "pointcloud";
  assets: {
    pointcloudUrl?: string;
    pointcloudGlbUrl?: string;
    splatUrl?: string;
    rawSplatPlyUrl?: string;
    floorplanPngUrl?: string;
    floorplanSvgUrl?: string;
    floorplanJsonUrl?: string;
    camerasJsonUrl?: string;
    hotspotsJsonUrl?: string;
    previewsJsonUrl?: string;
    depthPreviewUrl?: string;
    confidencePreviewUrl?: string;
    processingLogUrl?: string;
  };
  warnings: string[];
  error?: string;
};

export type Hotspot = {
  id: string;
  label: string;
  position: [number, number, number];
  lookAt: [number, number, number];
};

export type HotspotsPayload = {
  hotspots: Hotspot[];
};
