# Frontend Guide

The frontend lives in `apps/web` and uses:

- Next.js App Router
- React
- Tailwind
- Three.js through `@react-three/fiber`
- Drei `OrbitControls`
- Three `PLYLoader`

## Pages

### `/`

Implemented in `apps/web/app/page.tsx`.

Responsibilities:

- Show the RoomFly upload interface.
- Show capture tips.
- Upload the selected video through `uploadSceneVideo`.
- Call `startSceneProcessing`.
- Poll `getScene` while status is `processing`.
- Show an embedded viewer preview.
- Link to `/viewer/{sceneId}` when done.

### `/viewer/[sceneId]`

Implemented in `apps/web/app/viewer/[sceneId]/page.tsx`.

Responsibilities:

- Poll scene status by ID.
- Render the full viewer.
- Render floorplan, processing state, and scene metadata panels.

## API Client

`apps/web/lib/api.ts` wraps all calls to the Rust API:

- `uploadSceneVideo(file)`
- `startSceneProcessing(sceneId)`
- `getScene(sceneId)`
- `fetchHotspots(url)`

It reads:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

## Shared Types

`apps/web/lib/sceneTypes.ts` defines:

- `SceneResult`
- `SceneStatus`
- `Hotspot`
- `HotspotsPayload`

These match the Rust response shape and the JSON schema in `shared/scene-schema`.

## Main Components

### `VideoUpload`

File picker and upload button. It accepts video files and passes the selected `File` back to the page.

### `ProcessingStatus`

Displays uploaded, processing, done, and failed states. It also shows warnings and errors returned by the API.

### `RoomViewer`

Chooses visual mode:

- if `visualMode === "splat"` and `splatUrl` exists, render `SplatViewer`;
- otherwise render `PointCloudViewer`.

It also loads hotspots from `hotspotsJsonUrl`.

### `PointCloudViewer`

Uses React Three Fiber and `PLYLoader` to load `.ply` point clouds.

If no point cloud URL is available yet, it renders a procedural placeholder room so the UI still has a useful preview.

### `SplatViewer`

Currently a boundary component. It shows that a splat asset exists and provides a link to open it externally. A production version should integrate a browser Gaussian splat viewer library here.

### `FloorplanPanel`

Displays `floorplanSvgUrl` first, then falls back to `floorplanPngUrl`.

### `SceneInfoPanel`

Displays scene ID, status, active visual mode, capture-quality guidance, and optional depth/confidence preview images when Modal returns them.

### `HotspotOverlay`

Renders clickable hotspot buttons. Selecting a hotspot moves the point-cloud camera to the stored position/lookAt.

## Viewer Behavior

The MVP defaults to constrained walkthrough-style navigation:

- point cloud rendered in a dark 3D scene,
- grid floor for orientation,
- orbit controls with limited polar angle,
- fixed-height hotspot camera positions,
- reset camera button.

Free-fly movement is intentionally not the default.
