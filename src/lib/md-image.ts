import { api, ApiError } from "@/lib/api";
import { fileToBase64 } from "@/lib/work-instance-form";

/**
 * Private markdown image store.
 *
 * Images inserted from the user's disk into "md" fields are stored in the
 * app's own private S3 storage (no external/public image hosting) through
 * the session-authenticated `v1/md-image` endpoint. The markdown source
 * keeps a stable, permanent reference:
 *
 *     ![alt](/api/my/v1/md-image?img=<id>)
 *
 * The reference is resolved by {@link resolveMdImages} at render time: the
 * endpoint returns the bytes (base64) to the authenticated session and the
 * browser renders a local object URL. Replacing an image keeps the id (the
 * reference keeps working); deleting removes the object and metadata.
 */

export const MD_IMAGE_ENDPOINT = "/api/my/v1/md-image";
export const MD_IMAGE_REF_PREFIX = "/api/my/v1/md-image?img=";
export const MD_IMAGE_MAX_SIZE = 700 * 1024; // 700 KB (web-action 1 MB body cap)
export const MD_IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp";
export const MD_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export interface MdImageInfo {
  id: string;
  ref: string;
  fileName: string;
  size: number;
  contentType: string;
  createdAt: string;
  updatedAt: string;
}

export interface MdImageUploadResult {
  id: string;
  ref: string;
  fileName: string;
  size: number;
}

/** Stable reference written into the markdown source. */
export function mdImageRef(id: string): string {
  return `${MD_IMAGE_REF_PREFIX}${id}`;
}

/** Extract the image id from a reference URL or raw id. */
export function mdImageIdFromRef(value: string): string | null {
  const ref = String(value || "").trim();
  if (ref.startsWith(MD_IMAGE_REF_PREFIX)) {
    return ref.slice(MD_IMAGE_REF_PREFIX.length).split("?")[0] || null;
  }
  return /^[a-f0-9]{32}$/.test(ref) ? ref : null;
}

/** True when the src points at an app-managed image reference. */
export function isMdImageRef(src: string): boolean {
  return mdImageIdFromRef(src) !== null;
}

function base64ToBytes(content: string): Uint8Array {
  const byteChars = atob(content);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i += 1) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  return bytes;
}

export async function fetchImagePayload(
  id: string
): Promise<{ content: string; contentType: string }> {
  const data = await api<{
    ok: boolean;
    error?: string;
    image: { content: string; contentType: string };
  }>(`${MD_IMAGE_ENDPOINT}?img=${encodeURIComponent(id)}`);
  return { content: data.image.content, contentType: data.image.contentType };
}

/**
 * Resolve app-managed image references inside a rendered markdown
 * container: every `<img>` whose src is a reference URL is replaced with a
 * session-fetched object URL. Resolved references are cached per id for the
 * browser session so re-renders do not re-download the bytes.
 */
const blobCache = new Map<string, string>();

export function revokeCachedMdImages(): void {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobCache.clear();
}

function rememberBlob(id: string, blob: Blob): string {
  let url = blobCache.get(id);
  if (!url) {
    url = URL.createObjectURL(blob);
    blobCache.set(id, url);
  }
  return url;
}

const LOADING_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Resolve every `img[src^="/api/my/v1/md-image"]` in the container to a
 * fetched object URL. Safe to call on the same container multiple times;
 * already-resolved images are left untouched.
 */
export function resolveMdImages(container: HTMLElement): void {
  const images = Array.from(
    container.querySelectorAll<HTMLImageElement>(
      'img[src^="/api/my/v1/md-image"]'
    )
  );
  for (const img of images) {
    if (img.dataset.mdResolved === "1") continue;
    const id = mdImageIdFromRef(img.getAttribute("src") || "");
    if (!id) continue;
    img.dataset.mdResolved = "1";
    const cached = blobCache.get(id);
    if (cached) {
      img.src = cached;
      continue;
    }
    img.src = LOADING_SRC;
    img.alt = img.alt || "…";
    fetchImagePayload(id)
      .then(({ content, contentType }) => {
        const bytes = base64ToBytes(content);
        const blob = new Blob([bytes.buffer as ArrayBuffer], {
          type: contentType || "application/octet-stream",
        });
        img.src = rememberBlob(id, blob);
      })
      .catch(() => {
        // Session lost or image deleted: keep the alt text visible.
        delete img.dataset.mdResolved;
      });
  }
}

export async function listMdImages(): Promise<MdImageInfo[]> {
  const data = await api<{ ok: boolean; images: MdImageInfo[] }>(
    MD_IMAGE_ENDPOINT,
    {
      method: "POST",
      body: JSON.stringify({ operation: "list" }),
    }
  );
  return data.images ?? [];
}

/** Upload an image from the user's disk; returns the stable reference. */
export async function uploadMdImage(file: File): Promise<MdImageUploadResult> {
  const content = await fileToBase64(file);
  const data = await api<{ ok: boolean; image: MdImageInfo }>(
    MD_IMAGE_ENDPOINT,
    {
      method: "POST",
      body: JSON.stringify({
        operation: "upload",
        fileName: file.name,
        contentType: file.type,
        content,
      }),
    }
  );
  return {
    id: data.image.id,
    ref: data.image.ref,
    fileName: data.image.fileName,
    size: data.image.size,
  };
}

/** Replace the bytes of an existing image; the reference id is kept. */
export async function replaceMdImage(
  id: string,
  file: File
): Promise<MdImageUploadResult> {
  const content = await fileToBase64(file);
  const data = await api<{ ok: boolean; image: MdImageInfo }>(
    MD_IMAGE_ENDPOINT,
    {
      method: "POST",
      body: JSON.stringify({
        operation: "replace",
        id,
        fileName: file.name,
        contentType: file.type,
        content,
      }),
    }
  );
  return {
    id: data.image.id,
    ref: data.image.ref,
    fileName: data.image.fileName,
    size: data.image.size,
  };
}

export async function deleteMdImage(id: string): Promise<void> {
  await api(MD_IMAGE_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ operation: "delete", id }),
  });
  const url = blobCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobCache.delete(id);
  }
}

/** Human-readable error message for md-image failures (i18n aware). */
export function mdImageErrorMessage(
  err: unknown,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (err instanceof ApiError && err.serverKey) {
    return t(err.serverKey, err.serverParams ?? undefined);
  }
  return t("error.requestFailed", { status: "?" });
}
