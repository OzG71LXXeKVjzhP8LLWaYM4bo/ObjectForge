# Modal Pipeline

The Modal worker lives in `modal/modal_app.py`.

## Runtime

The Modal image installs:

- `ffmpeg`
- `colmap`
- `boto3`
- `fastapi[standard]`
- `opencv-python`
- `numpy`
- `open3d`
- `Pillow`
- `scipy`
- `torch`
- `torchvision`
- `VGGT` from `facebookresearch/vggt`

The function is exposed as a POST web endpoint:

```python
@app.function(
    image=image,
    gpu=["L4", "A10G"],
    timeout=1800,
    secrets=[modal.Secret.from_name("roomfly-s3")],
)
@modal.fastapi_endpoint(method="POST")
def process_scene(payload: dict[str, Any]) -> dict[str, Any]:
    ...
```

## Input Payload

```json
{
  "scene_id": "uuid",
  "input_video_key": "scenes/uuid/input/input.mp4",
  "output_prefix": "scenes/uuid/outputs",
  "s3_bucket": "roomfly-mvp"
}
```

## Processing Steps

### 1. Download Input Video

Modal reads storage credentials from the `roomfly-s3` secret and downloads the video from S3/R2.

### 2. Extract Keyframes

`extract_keyframes` uses OpenCV to:

- read the uploaded video,
- sample roughly 1-2 FPS,
- resize frames to max width `ROOMFLY_MAX_FRAME_WIDTH` or `960`,
- remove blurry frames using variance of Laplacian,
- remove near-duplicate frames,
- cap output at 150 frames.

Output:

```text
frames/frame_0000.jpg
frames/frame_0001.jpg
...
```

### 3. Run VGGT Reconstruction

`run_vggt_reconstruction` is the first real reconstruction path.

It uses:

- `VGGT.from_pretrained`
- `load_and_preprocess_images`
- VGGT camera head for extrinsics/intrinsics
- VGGT depth and point heads for dense geometry
- confidence maps to filter noisy points

The checkpoint defaults to `facebook/VGGT-1B` and can be changed with `VGGT_MODEL_ID`. If Hugging Face authentication is required, provide `HF_TOKEN` in the Modal Secret.

VGGT point clouds are sampled to `ROOMFLY_VGGT_MAX_POINTS`, defaulting to `1500000`.

It writes:

Output:

```text
pointcloud/room_pointcloud.ply
previews/depth_00.png
previews/confidence_00.png
```

If VGGT fails, Modal logs the error and falls back to `generate_mvp_pointcloud` so the app still returns a valid scene.

### 4. Generate Cameras and Hotspots

When VGGT succeeds, camera positions are derived from predicted extrinsics. If VGGT fails, synthetic camera positions are used.

`generate_hotspots` turns those cameras into Matterport-style navigation targets:

```json
{
  "hotspots": [
    {
      "id": "view_1",
      "label": "Entrance",
      "position": [0, 1.6, 1.25],
      "lookAt": [0, 1.4, 0]
    }
  ]
}
```

Outputs:

```text
metadata/cameras.json
metadata/hotspots.json
```

### 5. Generate Floorplan

`generate_floorplan` projects point-cloud X/Z coordinates into a top-down density map and creates:

```text
floorplan/floorplan.png
floorplan/floorplan.svg
floorplan/floorplan.json
```

The JSON output still includes a simple room polygon based on robust bounds. This is approximate and should not be treated as measured geometry.

### 6. Optional Splatfacto

If `ENABLE_SPLATFACTO=1`, the worker attempts:

```bash
ns-process-data video
ns-train splatfacto
ns-export gaussian-splat
```

This path is off by default because the image does not currently install Nerfstudio and because full splat optimization is slow for an MVP smoke test.

## Output

The worker uploads generated assets to S3/R2 and returns asset keys, not public URLs. The Rust API converts keys into browser-facing proxy URLs.

## Where to Improve Reconstruction

The next model improvements should happen inside or next to `run_vggt_reconstruction`:

1. tune frame sampling and confidence thresholds,
2. add optional COLMAP export from VGGT,
3. add Nerfstudio/Splatfacto as a separate heavier function,
4. add Fast3R or another model as a secondary fallback.

Keep the output contract stable:

```text
pointcloud/room_pointcloud.ply
metadata/cameras.json
floorplan/floorplan.{png,svg,json}
metadata/hotspots.json
```
