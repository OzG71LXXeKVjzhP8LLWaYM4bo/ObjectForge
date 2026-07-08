from __future__ import annotations

import base64
import contextlib
import json
import math
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import modal


app = modal.App("roomfly-mvp")
volume = modal.Volume.from_name("roomfly-data", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "git", "libgl1", "libglib2.0-0", "colmap")
    .pip_install(
        "boto3",
        "fastapi[standard]",
        "huggingface_hub",
        "opencv-python",
        "numpy",
        "open3d",
        "Pillow",
        "scipy",
        "torch",
        "torchvision",
        "trimesh",
        "git+https://github.com/facebookresearch/vggt.git",
    )
)

splat_image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install(
        "build-essential",
        "clang",
        "cmake",
        "ffmpeg",
        "git",
        "libgl1",
        "libglib2.0-0",
        "ninja-build",
    )
    .pip_install(
        "torch",
        "torchvision",
        "xformers",
    )
    .pip_install(
        "boto3",
        "fastapi[standard]",
        "numpy",
        "Pillow",
        "plyfile",
        "git+https://github.com/ByteDance-Seed/depth-anything-3.git",
    )
)


def lazy_boto3():
    import boto3

    return boto3


def lazy_cv2():
    import cv2

    return cv2


def lazy_np():
    import numpy as np

    return np


def lazy_pil():
    from PIL import Image, ImageDraw

    return Image, ImageDraw


def lazy_trimesh():
    import trimesh

    return trimesh


@dataclass
class ScenePaths:
    root: Path
    input_video: Path
    frames_dir: Path
    pointcloud_dir: Path
    previews_dir: Path
    floorplan_dir: Path
    metadata_dir: Path
    splat_dir: Path


@app.function(
    image=image,
    gpu=["L4", "A10G"],
    timeout=1800,
    volumes={"/data": volume},
)
@modal.fastapi_endpoint(method="POST")
def process_scene(payload: dict[str, Any]) -> dict[str, Any]:
    scene_id = payload["scene_id"]
    storage_backend = payload.get("storage_backend", "s3")
    bucket = payload.get("s3_bucket")
    input_video_key = payload.get("input_video_key", f"scenes/{scene_id}/input/input.mp4")
    output_prefix = payload["output_prefix"].rstrip("/")
    warnings: list[str] = []
    started_at = time.time()

    if storage_backend == "modal":
        root_context = contextlib.nullcontext(str(Path("/data/scenes") / scene_id))
    else:
        root_context = tempfile.TemporaryDirectory(prefix=f"roomfly-{scene_id}-")

    with root_context as tmp:
        root = Path(tmp)
        root.mkdir(parents=True, exist_ok=True)
        paths = ScenePaths(
            root=root,
            input_video=root / "input.mp4",
            frames_dir=root / "frames",
            pointcloud_dir=root / "pointcloud",
            previews_dir=root / "previews",
            floorplan_dir=root / "floorplan",
            metadata_dir=root / "metadata",
            splat_dir=root / "splat",
        )
        for directory in [
            paths.frames_dir,
            paths.pointcloud_dir,
            paths.previews_dir,
            paths.floorplan_dir,
            paths.metadata_dir,
            paths.splat_dir,
        ]:
            directory.mkdir(parents=True, exist_ok=True)

        s3 = None
        if storage_backend == "modal":
            video_payload = payload.get("video_bytes_base64")
            if not video_payload:
                raise RuntimeError("video_bytes_base64 is required for modal storage")
            paths.input_video.write_bytes(base64.b64decode(video_payload))
        else:
            if not bucket:
                raise RuntimeError("s3_bucket is required for s3 storage")
            s3 = make_s3_client()
            s3.download_file(bucket, input_video_key, str(paths.input_video))

        processing_log: dict[str, Any] = {
            "scene_id": scene_id,
            "input_video_key": input_video_key,
            "output_prefix": output_prefix,
            "storage_backend": storage_backend,
            "steps": [],
        }

        frames = extract_keyframes(paths.input_video, paths.frames_dir, processing_log)
        if len(frames) < 10:
            warnings.append("Few usable frames were extracted. Move slower and capture more room coverage.")

        pointcloud_path = paths.pointcloud_dir / "room_pointcloud.ply"
        pointcloud_glb_path = paths.pointcloud_dir / "room_pointcloud.glb"
        cameras_path = paths.metadata_dir / "cameras.json"
        hotspots_path = paths.metadata_dir / "hotspots.json"
        floorplan_png = paths.floorplan_dir / "floorplan.png"
        floorplan_svg = paths.floorplan_dir / "floorplan.svg"
        floorplan_json = paths.floorplan_dir / "floorplan.json"
        previews_path = paths.metadata_dir / "previews.json"
        processing_log_path = paths.metadata_dir / "processing_log.json"

        previews: dict[str, Any] = {"depth": [], "confidence": []}
        try:
            reconstruction = run_vggt_reconstruction(frames, pointcloud_path, paths.previews_dir, processing_log)
            points = reconstruction["points"]
            cameras = reconstruction["cameras"]
            previews = reconstruction["previews"]
        except Exception as exc:
            warnings.append(f"VGGT reconstruction failed, using MVP point-cloud fallback: {exc}")
            processing_log["steps"].append({"name": "vggt_reconstruction", "status": "failed", "error": str(exc)})
            points = generate_mvp_pointcloud(frames, pointcloud_path, processing_log)
            cameras = generate_cameras(len(frames), source="mvp_fallback")

        cameras_path.write_text(json.dumps({"cameras": cameras}, indent=2), encoding="utf-8")
        hotspots = generate_hotspots(cameras, points)
        hotspots_path.write_text(json.dumps({"hotspots": hotspots}, indent=2), encoding="utf-8")
        generate_floorplan(points, floorplan_png, floorplan_svg, floorplan_json, processing_log)
        previews_path.write_text(json.dumps(previews, indent=2), encoding="utf-8")
        write_pointcloud_glb(pointcloud_glb_path, pointcloud_path, processing_log)

        visual_mode = "pointcloud"
        splat_key = None
        if os.environ.get("ENABLE_SPLATFACTO") == "1":
            try:
                splat_path = run_splatfacto(paths, processing_log)
                if splat_path is not None:
                    visual_mode = "splat"
                    splat_key = store_asset(
                        storage_backend,
                        s3,
                        bucket,
                        output_prefix,
                        splat_path,
                        "splat/room_splat.ply",
                    )
            except Exception as exc:
                warnings.append(f"Splatfacto failed, using point cloud fallback: {exc}")
                processing_log["steps"].append({"name": "splatfacto", "status": "failed", "error": str(exc)})

        processing_log["duration_seconds"] = round(time.time() - started_at, 2)
        processing_log["warnings"] = warnings
        processing_log_path.write_text(json.dumps(processing_log, indent=2), encoding="utf-8")

        assets = {
            "pointcloudKey": store_asset(storage_backend, s3, bucket, output_prefix, pointcloud_path, "pointcloud/room_pointcloud.ply"),
            "pointcloudGlbKey": store_asset(storage_backend, s3, bucket, output_prefix, pointcloud_glb_path, "pointcloud/room_pointcloud.glb"),
            "splatKey": splat_key,
            "floorplanPngKey": store_asset(storage_backend, s3, bucket, output_prefix, floorplan_png, "floorplan/floorplan.png"),
            "floorplanSvgKey": store_asset(storage_backend, s3, bucket, output_prefix, floorplan_svg, "floorplan/floorplan.svg"),
            "floorplanJsonKey": store_asset(storage_backend, s3, bucket, output_prefix, floorplan_json, "floorplan/floorplan.json"),
            "camerasJsonKey": store_asset(storage_backend, s3, bucket, output_prefix, cameras_path, "metadata/cameras.json"),
            "hotspotsJsonKey": store_asset(storage_backend, s3, bucket, output_prefix, hotspots_path, "metadata/hotspots.json"),
            "previewsJsonKey": store_asset(storage_backend, s3, bucket, output_prefix, previews_path, "metadata/previews.json"),
            "processingLogKey": store_asset(storage_backend, s3, bucket, output_prefix, processing_log_path, "metadata/processing_log.json"),
        }
        for preview in previews["depth"]:
            store_asset(
                storage_backend,
                s3,
                bucket,
                output_prefix,
                paths.previews_dir / preview["file"],
                f"previews/{preview['file']}",
            )
        for preview in previews["confidence"]:
            store_asset(
                storage_backend,
                s3,
                bucket,
                output_prefix,
                paths.previews_dir / preview["file"],
                f"previews/{preview['file']}",
            )
        if previews["depth"]:
            assets["depthPreviewKey"] = store_asset(
                storage_backend,
                s3,
                bucket,
                output_prefix,
                paths.previews_dir / previews["depth"][0]["file"],
                f"previews/{previews['depth'][0]['file']}",
            )
        if previews["confidence"]:
            assets["confidencePreviewKey"] = store_asset(
                storage_backend,
                s3,
                bucket,
                output_prefix,
                paths.previews_dir / previews["confidence"][0]["file"],
                f"previews/{previews['confidence'][0]['file']}",
            )

        if storage_backend == "modal":
            volume.commit()

        return {
            "sceneId": scene_id,
            "status": "done",
            "visualMode": visual_mode,
            "assets": assets,
            "warnings": warnings,
        }


@app.function(image=image, volumes={"/data": volume})
@modal.fastapi_endpoint(method="GET")
def get_asset(scene_id: str, asset_path: str):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    if ".." in asset_path:
        raise HTTPException(status_code=400, detail="invalid asset path")
    volume.reload()
    path = Path("/data/scenes") / scene_id / asset_path.strip("/")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="asset not found")
    return FileResponse(path, media_type=guess_content_type(path))


@app.function(
    image=splat_image,
    gpu=["L4", "A10G"],
    timeout=7200,
    volumes={"/data": volume},
)
@modal.fastapi_endpoint(method="POST")
def generate_splat(payload: dict[str, Any]) -> dict[str, Any]:
    scene_id = payload["scene_id"]
    storage_backend = payload.get("storage_backend", "s3")
    bucket = payload.get("s3_bucket")
    input_video_key = payload.get("input_video_key", f"scenes/{scene_id}/input/input.mp4")
    output_prefix = payload["output_prefix"].rstrip("/")
    warnings: list[str] = []
    started_at = time.time()

    if storage_backend == "modal":
        root_context = contextlib.nullcontext(str(Path("/data/scenes") / scene_id))
    else:
        root_context = tempfile.TemporaryDirectory(prefix=f"roomfly-splat-{scene_id}-")

    with root_context as tmp:
        root = Path(tmp)
        root.mkdir(parents=True, exist_ok=True)
        input_video = root / "input.mp4"
        splat_dir = root / "splat"
        metadata_dir = root / "metadata"
        splat_dir.mkdir(parents=True, exist_ok=True)
        metadata_dir.mkdir(parents=True, exist_ok=True)

        s3 = None
        if storage_backend == "modal":
            video_payload = payload.get("video_bytes_base64")
            if video_payload:
                input_video.write_bytes(base64.b64decode(video_payload))
            elif not input_video.exists():
                raise RuntimeError("video_bytes_base64 is required for modal storage")
        else:
            if not bucket:
                raise RuntimeError("s3_bucket is required for s3 storage")
            s3 = make_s3_client()
            s3.download_file(bucket, input_video_key, str(input_video))

        processing_log: dict[str, Any] = {
            "scene_id": scene_id,
            "input_video_key": input_video_key,
            "output_prefix": output_prefix,
            "storage_backend": storage_backend,
            "steps": [],
        }

        splat_backend = os.environ.get("ROOMFLY_SPLAT_BACKEND", "da3_ply").lower()
        with tempfile.TemporaryDirectory(prefix=f"roomfly-splat-work-{scene_id}-") as work_tmp:
            if splat_backend == "da3_gs":
                raw_ply_path = run_da3_gaussian_splat(input_video, Path(work_tmp), splat_dir, processing_log)
            elif splat_backend == "da3_ply":
                raw_ply_path = run_da3_geometry_ply(input_video, Path(work_tmp), splat_dir, processing_log)
            else:
                raise RuntimeError(f"Unsupported ROOMFLY_SPLAT_BACKEND for this image: {splat_backend}")
        splat_path = splat_dir / "room_splat.splat"
        convert_gaussian_ply_to_splat(raw_ply_path, splat_path)
        processing_log["steps"].append(
            {
                "name": "convert_gaussian_ply_to_splat",
                "status": "done",
                "input": raw_ply_path.name,
                "output": splat_path.name,
            }
        )

        processing_log["duration_seconds"] = round(time.time() - started_at, 2)
        processing_log["warnings"] = warnings
        processing_log_path = metadata_dir / "splat_processing_log.json"
        processing_log_path.write_text(json.dumps(processing_log, indent=2), encoding="utf-8")

        splat_key = store_asset(
            storage_backend,
            s3,
            bucket,
            output_prefix,
            splat_path,
            "splat/room_splat.splat",
        )
        raw_splat_ply_key = store_asset(
            storage_backend,
            s3,
            bucket,
            output_prefix,
            raw_ply_path,
            "splat/room_splat.ply",
        )
        processing_log_key = store_asset(
            storage_backend,
            s3,
            bucket,
            output_prefix,
            processing_log_path,
            "metadata/splat_processing_log.json",
        )

        if storage_backend == "modal":
            volume.commit()

        return {
            "sceneId": scene_id,
            "status": "done",
            "visualMode": "splat",
            "assets": {
                "splatKey": splat_key,
                "rawSplatPlyKey": raw_splat_ply_key,
                "processingLogKey": processing_log_key,
            },
            "warnings": warnings,
        }


def make_s3_client():
    boto3 = lazy_boto3()
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT_URL"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("S3_REGION", "auto"),
    )


def extract_keyframes(video_path: Path, frames_dir: Path, log: dict[str, Any]) -> list[Path]:
    cv2 = lazy_cv2()
    np = lazy_np()
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError("Could not open uploaded video")

    fps = capture.get(cv2.CAP_PROP_FPS) or 30
    frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = frame_count / fps if fps else 0
    sample_fps = 2 if duration <= 60 else 1
    interval = max(1, int(fps / sample_fps))
    max_width = int(os.environ.get("ROOMFLY_MAX_FRAME_WIDTH", "960"))

    extracted: list[Path] = []
    previous_small = None
    index = 0
    kept = 0

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % interval != 0:
            index += 1
            continue

        height, width = frame.shape[:2]
        if width > max_width:
            scale = max_width / width
            frame = cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
        if blur_score < 50:
            index += 1
            continue

        small = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
        if previous_small is not None:
            diff = float(np.mean(np.abs(small.astype(np.float32) - previous_small.astype(np.float32))))
            if diff < 3.0:
                index += 1
                continue
        previous_small = small

        out_path = frames_dir / f"frame_{kept:04d}.jpg"
        cv2.imwrite(str(out_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        extracted.append(out_path)
        kept += 1
        index += 1
        if kept >= 150:
            break

    capture.release()
    log["steps"].append(
        {
            "name": "extract_keyframes",
            "status": "done",
            "fps": fps,
            "duration_seconds": duration,
            "kept_frames": len(extracted),
        }
    )
    return extracted


def run_vggt_reconstruction(
    frames: list[Path],
    pointcloud_path: Path,
    previews_dir: Path,
    log: dict[str, Any],
) -> dict[str, Any]:
    if not frames:
        raise RuntimeError("No keyframes available for VGGT")

    import torch
    from vggt.models.vggt import VGGT
    from vggt.utils.geometry import unproject_depth_map_to_point_map
    from vggt.utils.load_fn import load_and_preprocess_images
    from vggt.utils.pose_enc import pose_encoding_to_extri_intri

    max_frames = int(os.environ.get("ROOMFLY_VGGT_MAX_FRAMES", "64"))
    frame_paths = evenly_sample(frames, max_frames)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device != "cuda":
        raise RuntimeError("VGGT requires a Modal GPU runtime")

    capability = torch.cuda.get_device_capability()
    dtype = torch.bfloat16 if capability[0] >= 8 else torch.float16
    model_name = os.environ.get("VGGT_MODEL_ID", "facebook/VGGT-1B")

    started_at = time.time()
    images = load_and_preprocess_images([str(path) for path in frame_paths]).to(device)
    model = VGGT.from_pretrained(model_name).to(device)
    model.eval()

    with torch.no_grad():
        with torch.cuda.amp.autocast(dtype=dtype):
            batched_images = images[None]
            aggregated_tokens_list, ps_idx = model.aggregator(batched_images)
            pose_enc = model.camera_head(aggregated_tokens_list)[-1]
            extrinsic, intrinsic = pose_encoding_to_extri_intri(pose_enc, batched_images.shape[-2:])
            depth_map, depth_conf = model.depth_head(aggregated_tokens_list, batched_images, ps_idx)
            point_map, point_conf = model.point_head(aggregated_tokens_list, batched_images, ps_idx)

    depth = tensor_to_numpy(depth_map.squeeze(0))
    depth_conf_np = tensor_to_numpy(depth_conf.squeeze(0))
    point_conf_np = tensor_to_numpy(point_conf.squeeze(0))
    point_maps = tensor_to_numpy(point_map.squeeze(0))

    reconstruction_confidence = point_conf_np
    try:
        unprojected = unproject_depth_map_to_point_map(
            depth_map.squeeze(0),
            extrinsic.squeeze(0),
            intrinsic.squeeze(0),
        )
        point_maps = tensor_to_numpy(unprojected)
        reconstruction_confidence = depth_conf_np
    except Exception:
        pass

    colors = load_point_colors(frame_paths, target_hw=point_maps.shape[1:3])
    points_with_color, xyz = point_maps_to_colored_points(
        point_maps,
        colors,
        reconstruction_confidence,
        max_points=int(os.environ.get("ROOMFLY_VGGT_MAX_POINTS", "750000")),
        log=log,
    )
    if len(points_with_color) < 1000:
        raise RuntimeError(f"VGGT produced too few usable points: {len(points_with_color)}")

    write_ascii_ply(pointcloud_path, points_with_color)
    cameras = cameras_from_vggt_extrinsics(tensor_to_numpy(extrinsic.squeeze(0)))
    previews = write_vggt_previews(depth, depth_conf_np, previews_dir)

    log["steps"].append(
        {
            "name": "vggt_reconstruction",
            "status": "done",
            "model": model_name,
            "input_frames": len(frame_paths),
            "points": len(points_with_color),
            "duration_seconds": round(time.time() - started_at, 2),
        }
    )

    return {"points": xyz, "cameras": cameras, "previews": previews}


def evenly_sample(values: list[Path], limit: int) -> list[Path]:
    np = lazy_np()
    if len(values) <= limit:
        return values
    indices = np.linspace(0, len(values) - 1, limit).round().astype(int)
    return [values[int(index)] for index in indices]


def tensor_to_numpy(value: Any) -> np.ndarray:
    np = lazy_np()
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "float"):
        value = value.float()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        return value.numpy()
    return np.asarray(value)


def load_point_colors(frame_paths: list[Path], target_hw: tuple[int, int]) -> np.ndarray:
    cv2 = lazy_cv2()
    np = lazy_np()
    height, width = target_hw
    colors = []
    for frame_path in frame_paths:
        image = cv2.imread(str(frame_path))
        if image is None:
            image = np.zeros((height, width, 3), dtype=np.uint8)
        else:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
        colors.append(image)
    return np.stack(colors, axis=0)


def point_maps_to_colored_points(
    point_maps: np.ndarray,
    colors: np.ndarray,
    confidence: np.ndarray,
    max_points: int,
    log: dict[str, Any] | None = None,
) -> tuple[list[tuple[float, float, float, int, int, int, float, int]], np.ndarray]:
    np = lazy_np()
    if point_maps.ndim != 4 or point_maps.shape[-1] != 3:
        raise RuntimeError(f"Unexpected VGGT point map shape: {point_maps.shape}")

    xyz = point_maps.reshape(-1, 3).astype(np.float32)
    rgb = colors.reshape(-1, 3).astype(np.uint8)
    conf = confidence.reshape(-1).astype(np.float32)
    frame_ids = np.repeat(np.arange(point_maps.shape[0], dtype=np.int32), point_maps.shape[1] * point_maps.shape[2])
    raw_count = len(xyz)

    finite_conf = conf[np.isfinite(conf)]
    if finite_conf.size == 0:
        raise RuntimeError("VGGT confidence map did not contain finite values")

    confidence_percentile = float(os.environ.get("ROOMFLY_VGGT_CONF_PERCENTILE", "72"))
    confidence_threshold = np.percentile(finite_conf, confidence_percentile)
    valid = np.isfinite(xyz).all(axis=1) & np.isfinite(conf) & (conf >= confidence_threshold)
    xyz = xyz[valid]
    rgb = rgb[valid]
    conf = conf[valid]
    frame_ids = frame_ids[valid]

    if len(xyz) >= 1000:
        center = np.median(xyz, axis=0)
        centered = xyz - center
        distance = np.linalg.norm(centered, axis=1)
        distance_limit = np.percentile(distance[np.isfinite(distance)], 96)
        lower = np.percentile(xyz, 1, axis=0)
        upper = np.percentile(xyz, 99, axis=0)
        inlier = (
            np.isfinite(distance)
            & (distance <= distance_limit)
            & np.all((xyz >= lower) & (xyz <= upper), axis=1)
        )
        xyz = xyz[inlier]
        rgb = rgb[inlier]
        conf = conf[inlier]
        frame_ids = frame_ids[inlier]

    finite_kept_conf = conf[np.isfinite(conf)]
    if finite_kept_conf.size:
        conf_min = float(np.percentile(finite_kept_conf, 1))
        conf_max = float(np.percentile(finite_kept_conf, 99))
        if conf_max <= conf_min:
            conf_max = conf_min + 1.0
        normalized_conf = np.clip((conf - conf_min) / (conf_max - conf_min), 0, 1).astype(np.float32)
    else:
        normalized_conf = np.ones(len(xyz), dtype=np.float32)

    if len(xyz) > max_points:
        rng = np.random.default_rng(42)
        indices = rng.choice(len(xyz), size=max_points, replace=False)
        xyz = xyz[indices]
        rgb = rgb[indices]
        normalized_conf = normalized_conf[indices]
        frame_ids = frame_ids[indices]

    xyz = normalize_scene_points(xyz)
    if log is not None:
        log["steps"].append(
            {
                "name": "filter_vggt_points",
                "status": "done",
                "raw_points": raw_count,
                "kept_points": len(xyz),
                "confidence_percentile": confidence_percentile,
                "max_points": max_points,
            }
        )
    points = [
        (float(x), float(y), float(z), int(r), int(g), int(b), float(c), int(frame))
        for (x, y, z), (r, g, b), c, frame in zip(xyz, rgb, normalized_conf, frame_ids, strict=False)
    ]
    return points, xyz


def normalize_scene_points(points: np.ndarray) -> np.ndarray:
    np = lazy_np()
    if points.size == 0:
        return points
    center = np.median(points, axis=0)
    centered = points - center
    scale = np.percentile(np.linalg.norm(centered, axis=1), 95)
    if not np.isfinite(scale) or scale <= 0:
        scale = 1.0
    return centered / scale * 2.25


def cameras_from_vggt_extrinsics(extrinsics: np.ndarray) -> list[dict[str, Any]]:
    np = lazy_np()
    cameras = []
    if extrinsics.ndim != 3 or extrinsics.shape[-2:] != (3, 4):
        return generate_cameras(8, source="vggt_fallback")

    centers = []
    for matrix in extrinsics:
        rotation = matrix[:, :3]
        translation = matrix[:, 3]
        center = -rotation.T @ translation
        centers.append(center)
    centers_np = normalize_scene_points(np.asarray(centers, dtype=np.float32))
    room_center = np.median(centers_np, axis=0) if len(centers_np) else np.zeros(3)

    for index, center in enumerate(centers_np):
        position = [round(float(center[0]), 3), 1.6, round(float(center[2]), 3)]
        look_at = [round(float(room_center[0]), 3), 1.4, round(float(room_center[2]), 3)]
        cameras.append(
            {
                "id": f"camera_{index + 1}",
                "position": position,
                "lookAt": look_at,
                "source": "vggt",
            }
        )
    return cameras


def write_vggt_previews(depth: np.ndarray, confidence: np.ndarray, previews_dir: Path) -> dict[str, Any]:
    np = lazy_np()
    previews = {"depth": [], "confidence": []}
    if depth.ndim < 3:
        return previews

    sample_indices = np.linspace(0, depth.shape[0] - 1, min(4, depth.shape[0])).round().astype(int)
    for output_index, frame_index in enumerate(sample_indices):
        depth_name = f"depth_{output_index:02d}.png"
        confidence_name = f"confidence_{output_index:02d}.png"
        write_normalized_png(depth[int(frame_index)], previews_dir / depth_name)
        write_normalized_png(confidence[int(frame_index)], previews_dir / confidence_name)
        previews["depth"].append({"frame": int(frame_index), "file": depth_name})
        previews["confidence"].append({"frame": int(frame_index), "file": confidence_name})
    return previews


def write_normalized_png(values: np.ndarray, output_path: Path) -> None:
    np = lazy_np()
    Image, _ = lazy_pil()
    values = np.asarray(values)
    if values.ndim == 3:
        values = values.squeeze()
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        image = np.zeros(values.shape[:2], dtype=np.uint8)
    else:
        low, high = np.percentile(finite, [2, 98])
        if high <= low:
            high = low + 1.0
        image = np.clip((values - low) / (high - low), 0, 1)
        image = (image * 255).astype(np.uint8)
    Image.fromarray(image).save(output_path)


def generate_mvp_pointcloud(frames: list[Path], out_path: Path, log: dict[str, Any]) -> np.ndarray:
    cv2 = lazy_cv2()
    np = lazy_np()
    points: list[tuple[float, float, float, int, int, int, float, int]] = []
    sample_frames = frames[: min(len(frames), 80)]
    rng = np.random.default_rng(42)

    for frame_index, frame_path in enumerate(sample_frames):
        image = cv2.imread(str(frame_path))
        if image is None:
            continue
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        image = cv2.resize(image, (96, 54), interpolation=cv2.INTER_AREA)
        angle = (frame_index / max(len(sample_frames), 1)) * math.tau
        wall = frame_index % 4

        for _ in range(180):
            px = int(rng.integers(0, image.shape[1]))
            py = int(rng.integers(0, image.shape[0]))
            r, g, b = [int(v) for v in image[py, px]]
            u = (px / max(image.shape[1] - 1, 1)) * 2 - 1
            v = 1 - py / max(image.shape[0] - 1, 1)
            jitter = float(rng.normal(0, 0.025))

            if wall == 0:
                x, z = u * 2.2, -2.0 + jitter
            elif wall == 1:
                x, z = 2.0 + jitter, u * 2.2
            elif wall == 2:
                x, z = -u * 2.2, 2.0 + jitter
            else:
                x, z = -2.0 + jitter, -u * 2.2
            y = max(0.05, min(2.7, v * 2.7 + float(rng.normal(0, 0.02))))
            points.append((x, y, z, r, g, b, 0.5, frame_index))

        camera_x = math.sin(angle) * 0.6
        camera_z = math.cos(angle) * 0.6
        points.append((camera_x, 1.6, camera_z, 36, 123, 109, 1.0, frame_index))

    if not points:
        points = fallback_room_points()

    write_ascii_ply(out_path, points)
    log["steps"].append({"name": "generate_mvp_pointcloud", "status": "done", "points": len(points)})
    return np.array([[p[0], p[1], p[2]] for p in points], dtype=np.float32)


def fallback_room_points() -> list[tuple[float, float, float, int, int, int, float, int]]:
    np = lazy_np()
    points = []
    for x in np.linspace(-2, 2, 80):
        for y in np.linspace(0, 2.6, 20):
            points.append((float(x), float(y), -2.0, 210, 198, 176, 0.5, 0))
            points.append((float(x), float(y), 2.0, 210, 198, 176, 0.5, 0))
    for z in np.linspace(-2, 2, 80):
        for y in np.linspace(0, 2.6, 20):
            points.append((-2.0, float(y), float(z), 190, 182, 166, 0.5, 0))
            points.append((2.0, float(y), float(z), 190, 182, 166, 0.5, 0))
    return points


def write_ascii_ply(out_path: Path, points: list[tuple[float, float, float, int, int, int, float, int]]) -> None:
    with out_path.open("w", encoding="utf-8") as file:
        file.write("ply\n")
        file.write("format ascii 1.0\n")
        file.write(f"element vertex {len(points)}\n")
        file.write("property float x\n")
        file.write("property float y\n")
        file.write("property float z\n")
        file.write("property uchar red\n")
        file.write("property uchar green\n")
        file.write("property uchar blue\n")
        file.write("property float confidence\n")
        file.write("property int frame\n")
        file.write("end_header\n")
        for x, y, z, r, g, b, confidence, frame in points:
            file.write(f"{x:.5f} {y:.5f} {z:.5f} {r} {g} {b} {confidence:.5f} {frame}\n")


def write_pointcloud_glb(
    out_path: Path,
    pointcloud_path: Path,
    log: dict[str, Any],
) -> None:
    np = lazy_np()
    trimesh = lazy_trimesh()
    vertices: list[list[float]] = []
    colors: list[list[int]] = []
    with pointcloud_path.open("r", encoding="utf-8") as file:
        in_body = False
        for line in file:
            if not in_body:
                if line.strip() == "end_header":
                    in_body = True
                continue
            parts = line.split()
            if len(parts) < 6:
                continue
            vertices.append([float(parts[0]), float(parts[1]), float(parts[2])])
            colors.append([int(parts[3]), int(parts[4]), int(parts[5]), 255])

    if not vertices:
        vertices = [[0.0, 0.0, 0.0]]
        colors = [[217, 210, 195, 255]]

    cloud = trimesh.points.PointCloud(
        vertices=np.asarray(vertices, dtype=np.float32),
        colors=np.asarray(colors, dtype=np.uint8),
    )
    cloud.export(out_path)
    log["steps"].append({"name": "write_pointcloud_glb", "status": "done", "points": len(vertices)})


def generate_cameras(frame_count: int, source: str = "synthetic") -> list[dict[str, Any]]:
    count = max(4, min(12, frame_count // 8 if frame_count else 4))
    cameras = []
    for index in range(count):
        angle = (index / count) * math.tau
        position = [round(math.sin(angle) * 1.25, 3), 1.6, round(math.cos(angle) * 1.25, 3)]
        cameras.append(
            {
                "id": f"camera_{index + 1}",
                "position": position,
                "lookAt": [0, 1.4, 0],
                "source": source,
            }
        )
    return cameras


def generate_hotspots(cameras: list[dict[str, Any]], points: np.ndarray | None = None) -> list[dict[str, Any]]:
    np = lazy_np()
    if not cameras:
        return []

    if points is not None and points.size:
        center = np.median(points[:, [0, 2]], axis=0)
        room_center = [round(float(center[0]), 3), 1.4, round(float(center[1]), 3)]
    else:
        room_center = [0, 1.4, 0]

    selected = select_representative_cameras(cameras, limit=8)
    labels = ["Entrance", "Center", "Corner A", "Corner B", "Window", "Wall", "Detail", "Overview"]
    return [
        {
            "id": f"view_{index + 1}",
            "label": labels[index] if index < len(labels) else f"View {index + 1}",
            "position": camera["position"],
            "lookAt": camera.get("lookAt", room_center),
        }
        for index, camera in enumerate(selected)
    ]


def select_representative_cameras(cameras: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    np = lazy_np()
    if len(cameras) <= limit:
        return cameras
    indices = np.linspace(0, len(cameras) - 1, limit).round().astype(int)
    return [cameras[int(index)] for index in indices]


def generate_floorplan(
    points: np.ndarray,
    png_path: Path,
    svg_path: Path,
    json_path: Path,
    log: dict[str, Any],
) -> None:
    np = lazy_np()
    if points.size == 0:
        points = np.array([[-2, 0, -2], [2, 0, 2]], dtype=np.float32)

    xz = points[:, [0, 2]].astype(np.float32)
    finite_mask = np.isfinite(xz).all(axis=1)
    xz = xz[finite_mask]
    if len(xz) < 100:
        xz = np.array([[-2, -2], [2, 2]], dtype=np.float32)
    lower = np.percentile(xz, 2, axis=0)
    upper = np.percentile(xz, 98, axis=0)
    min_x, min_z = lower.tolist()
    max_x, max_z = upper.tolist()

    size = 512
    margin = 48
    image = draw_density_floorplan(xz, (min_x, min_z, max_x, max_z), size=size, margin=margin)
    image.save(png_path)

    polygon = [[min_x, min_z], [max_x, min_z], [max_x, max_z], [min_x, max_z]]
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="Approximate floorplan">
  <rect width="{size}" height="{size}" fill="#f4f1eb"/>
  <rect x="{margin}" y="{margin}" width="{size - 2 * margin}" height="{size - 2 * margin}" fill="none" stroke="#15171a" stroke-width="4"/>
  <rect x="{margin + 12}" y="{margin + 12}" width="{size - 2 * (margin + 12)}" height="{size - 2 * (margin + 12)}" fill="none" stroke="#247b6d" stroke-width="2"/>
  <text x="{margin}" y="{size - margin + 24}" font-family="Arial" font-size="18" fill="#15171a">Approximate floorplan from point cloud</text>
</svg>
"""
    svg_path.write_text(svg, encoding="utf-8")

    payload = {
        "label": "approximate",
        "bounds": {
            "min": [min_x, min_z],
            "max": [max_x, max_z],
        },
        "polygon": polygon,
        "confidence": "density_projection",
    }
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    log["steps"].append({"name": "generate_floorplan", "status": "done", "method": "density_projection"})


def draw_density_floorplan(
    xz: np.ndarray,
    bounds: tuple[float, float, float, float],
    size: int,
    margin: int,
) -> Image.Image:
    cv2 = lazy_cv2()
    np = lazy_np()
    Image, ImageDraw = lazy_pil()
    min_x, min_z, max_x, max_z = bounds
    span_x = max(max_x - min_x, 1e-6)
    span_z = max(max_z - min_z, 1e-6)
    grid_size = size - 2 * margin
    px = ((xz[:, 0] - min_x) / span_x * (grid_size - 1)).clip(0, grid_size - 1).astype(np.int32)
    py = ((xz[:, 1] - min_z) / span_z * (grid_size - 1)).clip(0, grid_size - 1).astype(np.int32)

    density = np.zeros((grid_size, grid_size), dtype=np.float32)
    density[py, px] += 1
    density = cv2.GaussianBlur(density, (0, 0), sigmaX=3)
    if density.max() > 0:
        density = density / density.max()

    heat = (density * 190).astype(np.uint8)
    heat_rgb = np.zeros((grid_size, grid_size, 3), dtype=np.uint8)
    heat_rgb[..., 0] = 245 - heat // 3
    heat_rgb[..., 1] = 241 - heat // 2
    heat_rgb[..., 2] = 235 - heat

    image = Image.new("RGB", (size, size), "#f4f1eb")
    image.paste(Image.fromarray(heat_rgb), (margin, margin))
    draw = ImageDraw.Draw(image)
    draw.rectangle((margin, margin, size - margin, size - margin), outline="#15171a", width=4)
    draw.rectangle((margin + 12, margin + 12, size - margin - 12, size - margin - 12), outline="#247b6d", width=2)
    draw.text((margin, size - margin + 12), "Approximate floorplan from point cloud", fill="#15171a")
    return image


def run_splatfacto(paths: ScenePaths, log: dict[str, Any]) -> Path | None:
    scene_dir = paths.root / "nerfstudio_scene"
    exported_dir = paths.root / "exported_splat"
    scene_dir.mkdir(exist_ok=True)
    exported_dir.mkdir(exist_ok=True)

    subprocess.run(
        [
            "ns-process-data",
            "video",
            "--data",
            str(paths.input_video),
            "--output-dir",
            str(scene_dir),
        ],
        check=True,
    )
    subprocess.run(["ns-train", "splatfacto", "--data", str(scene_dir)], check=True)
    config_candidates = sorted(paths.root.glob("**/config.yml"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not config_candidates:
        raise RuntimeError("Nerfstudio did not produce config.yml")

    subprocess.run(
        [
            "ns-export",
            "gaussian-splat",
            "--load-config",
            str(config_candidates[0]),
            "--output-dir",
            str(exported_dir),
        ],
        check=True,
    )
    candidates = list(exported_dir.glob("*.ply"))
    if not candidates:
        raise RuntimeError("Nerfstudio did not export a PLY splat")

    out = paths.splat_dir / "room_splat.ply"
    candidates[0].replace(out)
    log["steps"].append({"name": "splatfacto", "status": "done"})
    return out


def run_splatfacto_video(input_video: Path, root: Path, splat_dir: Path, log: dict[str, Any]) -> Path:
    scene_dir = root / "nerfstudio_splat_scene"
    output_dir = root / "nerfstudio_outputs"
    exported_dir = root / "exported_splat"
    num_frames_target = int(os.environ.get("ROOMFLY_SPLAT_NUM_FRAMES", "96"))
    max_iterations = int(os.environ.get("ROOMFLY_SPLAT_MAX_ITERATIONS", "3500"))
    scene_dir.mkdir(exist_ok=True)
    output_dir.mkdir(exist_ok=True)
    exported_dir.mkdir(exist_ok=True)

    started_at = time.time()
    run_logged_command(
        [
            "ns-process-data",
            "video",
            "--data",
            str(input_video),
            "--output-dir",
            str(scene_dir),
            "--matching-method",
            "sequential",
            "--num-frames-target",
            str(num_frames_target),
            "--no-gpu",
        ],
        log,
        "ns-process-data video",
    )

    run_logged_command(
        [
            "ns-train",
            "splatfacto",
            "--data",
            str(scene_dir),
            "--output-dir",
            str(output_dir),
            "--max-num-iterations",
            str(max_iterations),
            "--steps-per-save",
            str(max_iterations),
            "--steps-per-eval-image",
            str(max_iterations),
            "--steps-per-eval-all-images",
            str(max_iterations),
            "--vis",
            "tensorboard",
        ],
        log,
        "ns-train splatfacto",
    )
    config_candidates = sorted(output_dir.glob("**/config.yml"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not config_candidates:
        config_candidates = sorted(root.glob("**/config.yml"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not config_candidates:
        raise RuntimeError("Nerfstudio did not produce config.yml")

    run_logged_command(
        [
            "ns-export",
            "gaussian-splat",
            "--load-config",
            str(config_candidates[0]),
            "--output-dir",
            str(exported_dir),
        ],
        log,
        "ns-export gaussian-splat",
    )
    candidates = sorted(exported_dir.glob("*.ply"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise RuntimeError("Nerfstudio did not export a PLY splat")

    out = splat_dir / "room_splat.ply"
    candidates[0].replace(out)
    log["steps"].append(
        {
            "name": "splatfacto_total",
            "status": "done",
            "num_frames_target": num_frames_target,
            "max_iterations": max_iterations,
            "duration_seconds": round(time.time() - started_at, 2),
        }
    )
    return out


def run_da3_gaussian_splat(input_video: Path, root: Path, splat_dir: Path, log: dict[str, Any]) -> Path:
    import torch
    from depth_anything_3.api import DepthAnything3

    frames_dir = root / "da3_frames"
    export_dir = root / "da3_export"
    frames_dir.mkdir(exist_ok=True)
    export_dir.mkdir(exist_ok=True)

    num_frames_target = int(os.environ.get("ROOMFLY_DA3_NUM_FRAMES", "32"))
    model_id = os.environ.get("ROOMFLY_DA3_MODEL_ID", "depth-anything/DA3NESTED-GIANT-LARGE-1.1")
    use_ray_pose = os.environ.get("ROOMFLY_DA3_USE_RAY_POSE", "0") == "1"
    started_at = time.time()

    extract_da3_frames(input_video, frames_dir, num_frames_target, log)
    frames = sorted(frames_dir.glob("*.jpg"))
    if len(frames) < 2:
        raise RuntimeError("DA3 requires at least two extracted frames")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        raise RuntimeError("DA3 Gaussian export requires a Modal GPU runtime")

    model_started_at = time.time()
    model = DepthAnything3.from_pretrained(model_id).to(device=device)
    prediction = model.inference(
        [str(frame) for frame in frames],
        export_dir=str(export_dir),
        export_format="gs_ply",
        use_ray_pose=use_ray_pose,
    )
    log["steps"].append(
        {
            "name": "da3_gs_inference",
            "status": "done",
            "model": model_id,
            "frames": len(frames),
            "device": str(device),
            "use_ray_pose": use_ray_pose,
            "duration_seconds": round(time.time() - model_started_at, 2),
            "depth_shape": list(getattr(prediction.depth, "shape", [])),
        }
    )

    candidates = sorted(export_dir.glob("**/*.ply"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise RuntimeError("DA3 did not export a Gaussian PLY")

    out = splat_dir / "room_splat.ply"
    candidates[0].replace(out)
    log["steps"].append(
        {
            "name": "da3_gs_total",
            "status": "done",
            "model": model_id,
            "frames": len(frames),
            "duration_seconds": round(time.time() - started_at, 2),
        }
    )
    return out


def run_da3_geometry_ply(input_video: Path, root: Path, splat_dir: Path, log: dict[str, Any]) -> Path:
    import torch
    from depth_anything_3.api import DepthAnything3

    frames_dir = root / "da3_frames"
    export_dir = root / "da3_export"
    frames_dir.mkdir(exist_ok=True)
    export_dir.mkdir(exist_ok=True)

    num_frames_target = int(os.environ.get("ROOMFLY_DA3_NUM_FRAMES", "16"))
    model_id = os.environ.get("ROOMFLY_DA3_MODEL_ID", "depth-anything/DA3NESTED-GIANT-LARGE-1.1")
    started_at = time.time()

    extract_da3_frames(input_video, frames_dir, num_frames_target, log)
    frames = sorted(frames_dir.glob("*.jpg"))
    if len(frames) < 2:
        raise RuntimeError("DA3 requires at least two extracted frames")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        raise RuntimeError("DA3 requires a Modal GPU runtime")

    model_started_at = time.time()
    model = DepthAnything3.from_pretrained(model_id).to(device=device)
    prediction = model.inference(
        [str(frame) for frame in frames],
        export_dir=str(export_dir),
        export_format="ply",
    )
    log["steps"].append(
        {
            "name": "da3_ply_inference",
            "status": "done",
            "model": model_id,
            "frames": len(frames),
            "device": str(device),
            "duration_seconds": round(time.time() - model_started_at, 2),
            "depth_shape": list(getattr(prediction.depth, "shape", [])),
            "conf_shape": list(getattr(prediction.conf, "shape", [])),
            "extrinsics_shape": list(getattr(prediction.extrinsics, "shape", [])),
            "intrinsics_shape": list(getattr(prediction.intrinsics, "shape", [])),
        }
    )

    candidates = sorted(export_dir.glob("**/*.ply"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise RuntimeError("DA3 did not export a PLY")

    out = splat_dir / "room_splat.ply"
    candidates[0].replace(out)
    log["steps"].append(
        {
            "name": "da3_ply_total",
            "status": "done",
            "model": model_id,
            "frames": len(frames),
            "duration_seconds": round(time.time() - started_at, 2),
        }
    )
    return out


def extract_da3_frames(input_video: Path, frames_dir: Path, num_frames_target: int, log: dict[str, Any]) -> None:
    run_logged_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_video),
            "-vf",
            da3_frame_filter(input_video, num_frames_target),
            "-fps_mode",
            "vfr",
            "-frames:v",
            str(num_frames_target),
            str(frames_dir / "frame_%04d.jpg"),
        ],
        log,
        "extract_da3_frames",
    )


def video_frame_interval(input_video: Path, target_frames: int) -> int:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_packets",
            "-show_entries",
            "stream=nb_read_packets",
            "-of",
            "csv=p=0",
            str(input_video),
        ],
        text=True,
        capture_output=True,
    )
    try:
        frame_count = int(result.stdout.strip())
    except ValueError:
        frame_count = target_frames
    return max(1, math.floor(frame_count / max(1, target_frames)))


def da3_frame_filter(input_video: Path, target_frames: int) -> str:
    interval = max(1, video_frame_interval(input_video, target_frames))
    return f"select=not(mod(n\\,{interval})),scale=w='min(960,iw)':h=-2"


def run_logged_command(command: list[str], log: dict[str, Any], name: str) -> None:
    started_at = time.time()
    env = os.environ.copy()
    env.setdefault("QT_QPA_PLATFORM", "offscreen")
    runtime_dir = Path("/tmp/roomfly-xdg-runtime")
    runtime_dir.mkdir(mode=0o700, exist_ok=True)
    runtime_dir.chmod(0o700)
    env.setdefault("XDG_RUNTIME_DIR", str(runtime_dir))
    result = subprocess.run(command, text=True, capture_output=True, env=env)
    stdout_tail = tail_text(result.stdout)
    stderr_tail = tail_text(result.stderr)
    step = {
        "name": name,
        "command": command,
        "status": "done" if result.returncode == 0 else "failed",
        "returncode": result.returncode,
        "duration_seconds": round(time.time() - started_at, 2),
        "stdout_tail": stdout_tail,
        "stderr_tail": stderr_tail,
    }
    log["steps"].append(step)
    if result.returncode != 0:
        detail = stderr_tail or stdout_tail or f"exit code {result.returncode}"
        raise RuntimeError(f"{name} failed: {detail}")


def tail_text(value: str, limit: int = 4000) -> str:
    value = value.strip()
    if len(value) <= limit:
        return value
    return value[-limit:]


def convert_gaussian_ply_to_splat(ply_path: Path, splat_path: Path) -> None:
    import struct

    np = lazy_np()
    vertices = read_gaussian_ply_vertices(ply_path)
    if not vertices:
        raise RuntimeError("Gaussian PLY contains no vertices")

    rows: list[tuple[float, bytes]] = []
    for vertex in vertices:
        x = float(vertex.get("x", 0.0))
        y = float(vertex.get("y", 0.0))
        z = float(vertex.get("z", 0.0))
        scale = [
            float(np.exp(float(vertex.get("scale_0", -5.0)))),
            float(np.exp(float(vertex.get("scale_1", -5.0)))),
            float(np.exp(float(vertex.get("scale_2", -5.0)))),
        ]
        opacity = sigmoid(float(vertex.get("opacity", 0.0)))
        red, green, blue = gaussian_rgb(vertex)
        rgba = bytes([red, green, blue, int(np.clip(opacity * 255.0, 0, 255))])
        rotation = gaussian_rotation(vertex)
        rotation_bytes = bytes([int(np.clip((component * 128.0) + 128.0, 0, 255)) for component in rotation])
        row = struct.pack("<ffffff", x, y, z, scale[0], scale[1], scale[2]) + rgba + rotation_bytes
        importance = float(np.prod(scale) * opacity)
        rows.append((importance, row))

    rows.sort(key=lambda item: item[0], reverse=True)
    splat_path.write_bytes(b"".join(row for _, row in rows))


def read_gaussian_ply_vertices(ply_path: Path) -> list[dict[str, float]]:
    try:
        from plyfile import PlyData

        ply = PlyData.read(str(ply_path))
        vertex_data = ply["vertex"].data
        names = vertex_data.dtype.names or ()
        return [
            {name: float(row[name]) for name in names}
            for row in vertex_data
        ]
    except ImportError:
        return read_ascii_ply_vertices(ply_path)


def read_ascii_ply_vertices(ply_path: Path) -> list[dict[str, float]]:
    properties: list[str] = []
    vertices: list[dict[str, float]] = []
    with ply_path.open("r", encoding="utf-8") as file:
        in_vertex = False
        for line in file:
            stripped = line.strip()
            if stripped.startswith("element vertex"):
                in_vertex = True
                continue
            if in_vertex and stripped.startswith("property"):
                parts = stripped.split()
                properties.append(parts[-1])
                continue
            if stripped == "end_header":
                break
        for line in file:
            values = line.split()
            if len(values) < len(properties):
                continue
            vertices.append({name: float(value) for name, value in zip(properties, values, strict=False)})
    return vertices


def sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1.0 / (1.0 + z)
    z = math.exp(value)
    return z / (1.0 + z)


def gaussian_rgb(vertex: dict[str, float]) -> tuple[int, int, int]:
    np = lazy_np()
    sh_c0 = 0.28209479177387814
    if all(name in vertex for name in ("f_dc_0", "f_dc_1", "f_dc_2")):
        rgb = [
            (float(vertex[f"f_dc_{index}"]) * sh_c0 + 0.5) * 255.0
            for index in range(3)
        ]
    else:
        rgb = [
            float(vertex.get("red", vertex.get("r", 255.0))),
            float(vertex.get("green", vertex.get("g", 255.0))),
            float(vertex.get("blue", vertex.get("b", 255.0))),
        ]
    return tuple(int(np.clip(channel, 0, 255)) for channel in rgb)


def gaussian_rotation(vertex: dict[str, float]) -> list[float]:
    np = lazy_np()
    rotation = np.asarray(
        [
            float(vertex.get("rot_0", 1.0)),
            float(vertex.get("rot_1", 0.0)),
            float(vertex.get("rot_2", 0.0)),
            float(vertex.get("rot_3", 0.0)),
        ],
        dtype=np.float32,
    )
    norm = float(np.linalg.norm(rotation))
    if not np.isfinite(norm) or norm <= 0:
        return [1.0, 0.0, 0.0, 0.0]
    return (rotation / norm).tolist()


def store_asset(
    storage_backend: str,
    s3,
    bucket: str | None,
    output_prefix: str,
    local_path: Path,
    relative_key: str,
) -> str:
    if storage_backend == "modal":
        return relative_key
    if s3 is None or bucket is None:
        raise RuntimeError("S3 client and bucket are required for s3 storage")
    return upload_asset(s3, bucket, output_prefix, local_path, relative_key)


def upload_asset(s3, bucket: str, output_prefix: str, local_path: Path, relative_key: str) -> str:
    key = f"{output_prefix}/{relative_key}"
    content_type = guess_content_type(local_path)
    s3.upload_file(str(local_path), bucket, key, ExtraArgs={"ContentType": content_type})
    return key


def guess_content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".ply", ".splat"}:
        return "application/octet-stream"
    if suffix in {".glb", ".gltf"}:
        return "model/gltf-binary" if suffix == ".glb" else "model/gltf+json"
    if suffix == ".png":
        return "image/png"
    if suffix == ".svg":
        return "image/svg+xml"
    if suffix == ".json":
        return "application/json"
    return "application/octet-stream"
