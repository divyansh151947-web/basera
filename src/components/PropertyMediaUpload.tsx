"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ImagePlus, X, Star, ArrowUp, ArrowDown, Loader2, Video, Trash2, AlertCircle } from "lucide-react";

interface PropertyMediaUploadProps {
  propertyId: string;
  /** Reserved for storage backends that key uploads by tenant; unused by the
   *  local-disk driver (the API derives tenancy from the session). */
  organizationId?: string;
  initialImages: string[];
  initialVideoUrl: string | null;
  initialVideoPosterUrl: string | null;

  /**
   * "upload" (default) — the full editor: pick, preview, upload, reorder,
   *   remove. Requires an existing property the caller owns.
   * "select" — the same pickers/previews/validation with NO upload calls and
   *   no saved-media grid. Used by the Add Property form BEFORE the property
   *   record exists, so staff can choose their photos/video up front; the
   *   chosen files are handed back through `onSelectionChange` and re-queued
   *   in the post-creation media stage.
   */
  mode?: "upload" | "select";
  /** Files queued by a previous "select" stage; re-queued as pending work. */
  initialPendingImages?: File[];
  initialPendingVideo?: File | null;
  /** Called whenever the queued (not yet uploaded) selection changes. */
  onSelectionChange?: (images: File[], video: File | null) => void;
  /** Upload the queued files as soon as the component mounts (staged flow). */
  autoUploadOnMount?: boolean;
  /** Reports a completed upload so the parent can show a status checklist. */
  onUploaded?: (info: { kind: "images" | "video"; count: number }) => void;
}

interface PendingImage {
  file: File;
  previewUrl: string;
  id: string;
}

export function PropertyMediaUpload({
  propertyId,
  organizationId,
  initialImages,
  initialVideoUrl,
  initialVideoPosterUrl,
  mode = "upload",
  initialPendingImages,
  initialPendingVideo,
  onSelectionChange,
  autoUploadOnMount = false,
  onUploaded,
}: PropertyMediaUploadProps) {
  const [images, setImages] = useState<string[]>(initialImages);
  const [videoUrl, setVideoUrl] = useState<string | null>(initialVideoUrl);
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(initialVideoPosterUrl);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>(() =>
    (initialPendingImages ?? []).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      id: crypto.randomUUID(),
    }))
  );
  const [pendingVideo, setPendingVideo] = useState<File | null>(initialPendingVideo ?? null);
  const [pendingVideoPreview, setPendingVideoPreview] = useState<string | null>(() =>
    initialPendingVideo ? URL.createObjectURL(initialPendingVideo) : null
  );
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // Guards: the parent's inline callback would otherwise re-fire on every
  // parent render (and a setState in the parent could loop). Only notify when
  // the actual queued FILES change; only auto-upload the initial queue once.
  const lastSelectionSig = useRef<string>("");
  const autoUploadStarted = useRef(false);
  // Indirection so the mount-time auto-upload effect can call the latest
  // callbacks without being re-created (and re-fired) on every render.
  const uploadImagesRef = useRef<() => Promise<boolean>>(async () => true);
  const uploadVideoRef = useRef<() => Promise<boolean>>(async () => true);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setSuccess("");
    setTimeout(() => setError(""), 5000);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    setError("");
    setTimeout(() => setSuccess(""), 3000);
  }, []);

  // Report the queued selection to the parent (Add Property stage 1 → 2) but
  // only when the FILE SET actually changed, so inline parents can't loop.
  const selectionSig =
    pendingImages.map((p) => p.id).join(",") +
    "|" +
    (pendingVideo ? `${pendingVideo.name}:${pendingVideo.size}` : "");
  useEffect(() => {
    if (!onSelectionChange) return;
    if (lastSelectionSig.current === selectionSig) return;
    lastSelectionSig.current = selectionSig;
    onSelectionChange(
      pendingImages.map((p) => p.file),
      pendingVideo
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionSig]);

  // Staged Add Property flow: the property record exists the moment this
  // stage mounts, so any files chosen BEFORE creation are uploaded right away.
  // Failures stay queued (error + Upload buttons) and can be retried.
  // NOTE: the effect that performs this upload is declared BELOW the
  // uploadImages/uploadVideo callbacks (and below the ref-assignment effect)
  // — an effect placed here would run on mount BEFORE those refs are
  // populated and silently skip the image upload.
  const initialQueueRef = useRef<{ images: PendingImage[]; video: File | null }>({
    images: pendingImages,
    video: pendingVideo,
  });

  // Image handling
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newPending: PendingImage[] = [];
    for (const file of files) {
      // Client-side pre-validation
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        showError(`${file.name}: Unsupported format. Use JPEG, PNG, or WebP.`);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        showError(`${file.name}: Image exceeds 8 MB limit.`);
        continue;
      }
      newPending.push({
        file,
        previewUrl: URL.createObjectURL(file),
        id: crypto.randomUUID(),
      });
    }

    if (newPending.length > 0) {
      setPendingImages((prev) => [...prev, ...newPending]);
    }
    // Reset input so same file can be selected again
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, [showError]);

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const uploadImages = useCallback(async (): Promise<boolean> => {
    if (pendingImages.length === 0) return true;

    setUploading(true);
    setUploadProgress(`Uploading ${pendingImages.length} image${pendingImages.length !== 1 ? "s" : ""}...`);
    setError("");

    try {
      const formData = new FormData();
      for (const img of pendingImages) {
        formData.append("files", img.file);
      }

      const res = await fetch(`/api/properties/${propertyId}/images`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || "Failed to upload images.");
        return false;
      }

      setImages(data.images);
      // Clear pending and revoke preview URLs
      for (const img of pendingImages) {
        URL.revokeObjectURL(img.previewUrl);
      }
      setPendingImages([]);
      const count = data.uploaded?.length ?? 0;
      showSuccess(`Uploaded ${count} image${count !== 1 ? "s" : ""}.`);
      onUploaded?.({ kind: "images", count });
      return true;
    } catch {
      showError("Failed to upload images. Please try again.");
      return false;
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }, [pendingImages, propertyId, showError, showSuccess, onUploaded]);

  const removeImage = useCallback(async (url: string) => {
    setError("");
    const newImages = images.filter((u) => u !== url);

    try {
      const res = await fetch(`/api/properties/${propertyId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: newImages }),
      });

      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to remove image.");
        return;
      }

      setImages(data.images);
      showSuccess("Image removed.");
    } catch {
      showError("Failed to remove image. Please try again.");
    }
  }, [images, propertyId, showError, showSuccess]);

  const setCoverImage = useCallback(async (url: string) => {
    setError("");
    const newImages = [url, ...images.filter((u) => u !== url)];

    try {
      const res = await fetch(`/api/properties/${propertyId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: newImages }),
      });

      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to set cover image.");
        return;
      }

      setImages(data.images);
      showSuccess("Cover image updated.");
    } catch {
      showError("Failed to set cover image. Please try again.");
    }
  }, [images, propertyId, showError, showSuccess]);

  const moveImage = useCallback(async (index: number, direction: "up" | "down") => {
    const newImages = [...images];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newImages.length) return;
    [newImages[index], newImages[targetIndex]] = [newImages[targetIndex], newImages[index]];

    try {
      const res = await fetch(`/api/properties/${propertyId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: newImages }),
      });

      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to reorder images.");
        return;
      }

      setImages(data.images);
    } catch {
      showError("Failed to reorder images. Please try again.");
    }
  }, [images, propertyId, showError]);

  // Video handling
  const handleVideoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "video/mp4") {
      showError("Unsupported video format. Use MP4 (H.264).");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      showError("Video exceeds 100 MB limit.");
      return;
    }

    if (pendingVideoPreview) URL.revokeObjectURL(pendingVideoPreview);
    setPendingVideo(file);
    setPendingVideoPreview(URL.createObjectURL(file));
    if (videoInputRef.current) videoInputRef.current.value = "";
  }, [pendingVideoPreview, showError]);

  const uploadVideo = useCallback(async (): Promise<boolean> => {
    if (!pendingVideo) return true;

    setUploading(true);
    setUploadProgress("Uploading video...");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", pendingVideo);

      const res = await fetch(`/api/properties/${propertyId}/video`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || "Failed to upload video.");
        return false;
      }

      setVideoUrl(data.videoUrl);
      setPendingVideo(null);
      if (pendingVideoPreview) URL.revokeObjectURL(pendingVideoPreview);
      setPendingVideoPreview(null);
      showSuccess("Video uploaded successfully.");
      onUploaded?.({ kind: "video", count: 1 });
      return true;
    } catch {
      showError("Failed to upload video. Please try again.");
      return false;
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }, [pendingVideo, pendingVideoPreview, propertyId, showError, showSuccess, onUploaded]);

  const removeVideo = useCallback(async () => {
    setError("");

    try {
      const res = await fetch(`/api/properties/${propertyId}/video`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to remove video.");
        return;
      }

      setVideoUrl(null);
      setVideoPosterUrl(null);
      showSuccess("Video removed.");
    } catch {
      showError("Failed to remove video. Please try again.");
    }
  }, [propertyId, showError, showSuccess]);

  // Keep the mount-time auto-upload effect pointed at the latest callbacks
  // (re-assigned every render; the effect itself only ever runs once).
  useEffect(() => {
    uploadImagesRef.current = () => uploadImages();
    uploadVideoRef.current = () => uploadVideo();
  });

  // Mount-time auto-upload of the pre-creation queue (declared AFTER the
  // refs above are populated — React runs effects top-to-bottom, so placing
  // this earlier made the first call hit the identity stub and skip images).
  useEffect(() => {
    if (mode !== "upload" || !autoUploadOnMount || autoUploadStarted.current) return;
    if (initialQueueRef.current.images.length === 0 && !initialQueueRef.current.video) return;
    autoUploadStarted.current = true;
    void (async () => {
      if (initialQueueRef.current.images.length > 0) {
        const ok = await uploadImagesRef.current();
        if (!ok) return;
      }
      if (initialQueueRef.current.video) await uploadVideoRef.current();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autoUploadOnMount]);

  const selectMode = mode === "select";

  return (
    <div className="space-y-6">
      {/* Images Section */}
      <div>
        <h3 className="text-sm font-semibold text-white/80 mb-3">Property Images</h3>

        {/* Saved images */}
        {!selectMode && images.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
            {images.map((url, idx) => (
              <div key={url} className="relative group aspect-[4/3] rounded-lg overflow-hidden border border-white/10 bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Property image ${idx + 1}`} className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  {idx > 0 && (
                    <button
                      onClick={() => moveImage(idx, "up")}
                      className="p-1.5 rounded bg-white/20 text-white hover:bg-white/30 transition"
                      aria-label="Move up"
                    >
                      <ArrowUp size={14} />
                    </button>
                  )}
                  {idx < images.length - 1 && (
                    <button
                      onClick={() => moveImage(idx, "down")}
                      className="p-1.5 rounded bg-white/20 text-white hover:bg-white/30 transition"
                      aria-label="Move down"
                    >
                      <ArrowDown size={14} />
                    </button>
                  )}
                  {idx !== 0 && (
                    <button
                      onClick={() => setCoverImage(url)}
                      className="p-1.5 rounded bg-white/20 text-[#ffdf9e] hover:bg-white/30 transition"
                      aria-label="Set as cover"
                    >
                      <Star size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => removeImage(url)}
                    className="p-1.5 rounded bg-red-500/50 text-white hover:bg-red-500/70 transition"
                    aria-label="Remove image"
                  >
                    <X size={14} />
                  </button>
                </div>
                {idx === 0 && (
                  <span className="absolute top-1 left-1 rounded bg-[#d8a94e]/80 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                    Cover
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pending images */}
        {pendingImages.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
            {pendingImages.map((img) => (
              <div key={img.id} className="relative group aspect-[4/3] rounded-lg overflow-hidden border border-[#d8a94e]/30 bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.previewUrl} alt="Pending" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={() => removePendingImage(img.id)}
                    className="p-1.5 rounded bg-red-500/50 text-white hover:bg-red-500/70 transition"
                    aria-label="Remove pending image"
                  >
                    <X size={14} />
                  </button>
                </div>
                <span className="absolute top-1 left-1 rounded bg-[#d8a94e]/80 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                  Pending
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Upload controls */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleImageSelect}
            className="hidden"
            aria-label="Select images to upload"
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 transition disabled:opacity-50"
          >
            <ImagePlus size={16} />
            Add Images
          </button>
          {!selectMode && pendingImages.length > 0 && (
            <button
              type="button"
              onClick={uploadImages}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-xl bg-[#d8a94e] px-4 py-2 text-sm font-semibold text-black hover:bg-[#e5bc60] transition disabled:opacity-50"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : null}
              Upload {pendingImages.length} Image{pendingImages.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-white/40">
          JPEG, PNG, or WebP. Max 8 MB per image. Up to 30 images. First image is the cover.
          {selectMode ? " You can pick them now — they upload as soon as the property is created." : ""}
        </p>
      </div>

      {/* Video Section */}
      <div>
        <h3 className="text-sm font-semibold text-white/80 mb-3">Property Video</h3>

        {videoUrl && !pendingVideo && !selectMode && (
          <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black mb-4">
            <video
              className="w-full aspect-video"
              controls
              playsInline
              preload="metadata"
              poster={videoPosterUrl ?? undefined}
            >
              <source src={videoUrl} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
            <button
              onClick={removeVideo}
              className="absolute top-2 right-2 p-2 rounded-full bg-red-500/70 text-white hover:bg-red-500 transition"
              aria-label="Remove video"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}

        {pendingVideo && pendingVideoPreview && (
          <div className="relative rounded-lg overflow-hidden border border-[#d8a94e]/30 bg-black mb-4">
            <video
              className="w-full aspect-video"
              controls
              playsInline
              preload="metadata"
              src={pendingVideoPreview}
            />
            <button
              type="button"
              onClick={() => {
                if (pendingVideoPreview) URL.revokeObjectURL(pendingVideoPreview);
                setPendingVideo(null);
                setPendingVideoPreview(null);
              }}
              className="absolute top-2 right-2 p-2 rounded-full bg-red-500/70 text-white hover:bg-red-500 transition"
              aria-label="Remove pending video"
            >
              <X size={16} />
            </button>
            <span className="absolute top-2 left-2 rounded bg-[#d8a94e]/80 px-1.5 py-0.5 text-[10px] font-semibold text-black">
              Pending
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4"
            onChange={handleVideoSelect}
            className="hidden"
            aria-label="Select video to upload"
          />
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 transition disabled:opacity-50"
          >
            <Video size={16} />
            {videoUrl || pendingVideo ? "Replace Video" : "Add Video"}
          </button>
          {!selectMode && pendingVideo && (
            <button
              type="button"
              onClick={uploadVideo}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-xl bg-[#d8a94e] px-4 py-2 text-sm font-semibold text-black hover:bg-[#e5bc60] transition disabled:opacity-50"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : null}
              Upload Video
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-white/40">
          MP4 (H.264). Max 100 MB. One video per property.
          {selectMode ? " Uploads as soon as the property is created." : ""}
        </p>
      </div>

      {/* Feedback */}
      {uploadProgress && (
        <div className="flex items-center gap-2 text-sm text-[#ffdf9e]">
          <Loader2 size={14} className="animate-spin" />
          {uploadProgress}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl p-3">
          {success}
        </div>
      )}
    </div>
  );
}
