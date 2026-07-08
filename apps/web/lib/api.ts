import type { HotspotsPayload, SceneResult } from "./sceneTypes";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type AuthToken = string | null | undefined;

function authHeaders(token?: AuthToken): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach the API at ${API_BASE_URL}. Check that the Rust API is running and WEB_ORIGIN matches this frontend URL.`
      );
    }

    throw error;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function uploadSceneVideo(file: File, token?: AuthToken): Promise<SceneResult> {
  const formData = new FormData();
  formData.append("video", file);

  const response = await apiFetch("/api/scenes", {
    method: "POST",
    headers: authHeaders(token),
    body: formData
  });

  return parseJson<SceneResult>(response);
}

export async function startSceneProcessing(sceneId: string, token?: AuthToken): Promise<SceneResult> {
  const response = await apiFetch(`/api/scenes/${sceneId}/process`, {
    method: "POST",
    headers: authHeaders(token)
  });

  return parseJson<SceneResult>(response);
}

export async function generateSceneSplat(sceneId: string, token?: AuthToken): Promise<SceneResult> {
  const response = await apiFetch(`/api/scenes/${sceneId}/splat`, {
    method: "POST",
    headers: authHeaders(token)
  });

  return parseJson<SceneResult>(response);
}

export async function getScene(sceneId: string, token?: AuthToken): Promise<SceneResult> {
  const response = await apiFetch(`/api/scenes/${sceneId}`, {
    headers: authHeaders(token),
    cache: "no-store"
  });

  return parseJson<SceneResult>(response);
}

export async function fetchHotspots(url?: string): Promise<HotspotsPayload> {
  if (!url) {
    return { hotspots: [] };
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return { hotspots: [] };
  }

  return response.json() as Promise<HotspotsPayload>;
}
