# Architecture

RoomFly MVP is split into three runtime systems:

```text
Next.js frontend
  -> Rust Axum API
      -> Postgres scene state
      -> S3/R2 object storage
      -> Modal Python web endpoint
          -> video/keyframe processing
          -> point cloud + floorplan + metadata generation
```

## Why This Split

The backend is Rust because upload handling, status APIs, and storage orchestration are conventional web-server work. The reconstruction code stays in Python because the relevant computer vision and 3D tooling is Python-first: OpenCV, Open3D, Nerfstudio, PyTorch-based models, Fast3R, VGGT, and related libraries.

## Data Flow

1. The user uploads a video from `apps/web`.
2. `apps/api` receives multipart form data at `POST /api/scenes`.
3. The API creates a UUID `scene_id`.
4. The API uploads the raw video to S3/R2 under:

   ```text
   scenes/{scene_id}/input/input.{ext}
   ```

5. The API writes a Postgres row with status `uploaded`.
6. The frontend calls `POST /api/scenes/{scene_id}/process`.
7. The API marks the scene `processing` and calls the Modal endpoint with:

   ```json
   {
     "scene_id": "...",
     "input_video_key": "scenes/.../input/input.mp4",
     "output_prefix": "scenes/.../outputs",
     "s3_bucket": "roomfly-mvp"
   }
   ```

8. Modal downloads the video from S3/R2, creates assets, uploads outputs, and returns asset keys.
9. The API stores those asset keys in Postgres and returns browser-facing asset URLs.
10. The frontend polls `GET /api/scenes/{scene_id}` and opens `/viewer/{scene_id}` when complete.

## Storage Layout

Generated assets follow this shape:

```text
scenes/{scene_id}/
  input/
    input.mp4
  outputs/
    pointcloud/
      room_pointcloud.ply
    floorplan/
      floorplan.png
      floorplan.svg
      floorplan.json
    metadata/
      cameras.json
      hotspots.json
      processing_log.json
    splat/
      room_splat.ply
```

The Rust API proxies assets through:

```text
GET /api/scenes/{scene_id}/assets/{asset_name}
```

This avoids exposing raw bucket credentials to the browser.

## Public Contract

The frontend and backend share the `SceneResult` shape:

```ts
type SceneResult = {
  sceneId: string;
  status: "uploaded" | "processing" | "done" | "failed";
  visualMode?: "splat" | "pointcloud";
  assets: {
    pointcloudUrl?: string;
    splatUrl?: string;
    floorplanPngUrl?: string;
    floorplanSvgUrl?: string;
    floorplanJsonUrl?: string;
    camerasJsonUrl?: string;
    hotspotsJsonUrl?: string;
    processingLogUrl?: string;
  };
  warnings: string[];
  error?: string;
};
```

The JSON schema version lives in `shared/scene-schema/scene-result.schema.json`.

## Reconstruction Behavior

The Modal worker now attempts VGGT first for real point cloud and camera prediction. If VGGT cannot run, it falls back to the deterministic MVP point cloud so the demo still produces viewer assets.

Splatfacto remains optional and disabled by default. It should be moved into a heavier Modal function before production use.
