# Modal Setup

Modal runs the Python GPU/vision worker. The default development setup stores generated scene files in a Modal Volume, so you do not need R2/S3 yet.

## Install with uv

```bash
cd /home/user/Documents/Github/roomfly-mvp/modal
uv venv
source .venv/bin/activate
uv pip install modal
modal token new
```

`modal token new` opens a browser and stores your Modal credentials locally.

## Deploy

```bash
cd /home/user/Documents/Github/roomfly-mvp/modal
modal deploy modal_app.py
```

Modal creates the `roomfly-data` Volume automatically and prints two endpoint URLs:

```text
https://your-workspace--roomfly-mvp-process-scene.modal.run
https://your-workspace--roomfly-mvp-get-asset.modal.run
```

Put both into `apps/api/.env`:

```env
STORAGE_BACKEND=modal
MODAL_PROCESS_URL=https://your-workspace--roomfly-mvp-process-scene.modal.run
MODAL_SPLAT_URL=https://your-workspace--roomfly-mvp-generate-splat.modal.run
MODAL_ASSET_URL=https://your-workspace--roomfly-mvp-get-asset.modal.run
```

## Serve During Development

For temporary live development:

```bash
cd /home/user/Documents/Github/roomfly-mvp/modal
modal serve modal_app.py
```

Use the ephemeral process and asset URLs printed by `modal serve` in `apps/api/.env`.

## File Sizes

Expect large assets:

- short phone video: often 50-500 MB
- point cloud: often 10-200 MB
- Gaussian splat: often hundreds of MB

The current API default caps uploads at 150 MB:

```env
MAX_UPLOAD_BYTES=157286400
```

Modal Volume is fine for a hackathon demo. Use R2/S3 later for durable object storage and better delivery.

## Current Worker Contract

With `STORAGE_BACKEND=modal`, Rust sends:

```json
{
  "storage_backend": "modal",
  "scene_id": "uuid",
  "video_bytes_base64": "...",
  "input_video_key": "scenes/uuid/input/input.mp4",
  "output_prefix": "scenes/uuid/outputs"
}
```

Modal stores files under:

```text
/data/scenes/{scene_id}/
  input.mp4
  pointcloud/room_pointcloud.ply
  floorplan/floorplan.png
  floorplan/floorplan.svg
  floorplan/floorplan.json
  metadata/cameras.json
  metadata/hotspots.json
  metadata/previews.json
  metadata/processing_log.json
  previews/depth_00.png
  previews/confidence_00.png
```

Modal returns relative asset keys:

```json
{
  "sceneId": "uuid",
  "status": "done",
  "visualMode": "pointcloud",
  "assets": {
    "pointcloudKey": "pointcloud/room_pointcloud.ply",
    "floorplanPngKey": "floorplan/floorplan.png",
    "floorplanSvgKey": "floorplan/floorplan.svg",
    "floorplanJsonKey": "floorplan/floorplan.json",
    "camerasJsonKey": "metadata/cameras.json",
    "hotspotsJsonKey": "metadata/hotspots.json",
    "processingLogKey": "metadata/processing_log.json"
  },
  "warnings": []
}
```
