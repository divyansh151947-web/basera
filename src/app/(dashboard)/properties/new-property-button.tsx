"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, ImagePlus, Film } from "lucide-react";
import { PropertyMediaUpload } from "@/components/PropertyMediaUpload";

/**
 * Add-property flow (two stages, matching the secure media architecture):
 *   1) Details + media selection — the image/video pickers are visible up
 *      front (no dead end: files chosen here are only QUEUED, never uploaded,
 *      because the media endpoints require an existing property).
 *   2) Media — POST /api/properties creates the record and returns its id;
 *      the queued files are re-mounted into the editor and uploaded
 *      automatically (with retry on failure). Staff can also skip stage 2 and
 *      add/replace media later from Edit Property.
 * No temporary public upload endpoints, no client-supplied storage paths or
 * tenant ids: identity and ownership come from the session on every request.
 */
export default function NewPropertyButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"details" | "media">("details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdPropertyId, setCreatedPropertyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    projectName: "", developer: "", propertyType: "APARTMENT", bhk: "", city: "", locality: "",
    priceMinInr: "", priceMaxInr: "", areaSqft: "", description: "",
  });

  // Media chosen BEFORE the record exists (stage 1) → uploaded automatically
  // in stage 2. `uploaded` reports what actually landed on the server.
  const [queuedImages, setQueuedImages] = useState<File[]>([]);
  const [queuedVideo, setQueuedVideo] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<{ images: number; video: boolean }>({ images: 0, video: false });
  const [stage2Pending, setStage2Pending] = useState<{ images: number; video: boolean }>({ images: 0, video: false });
  const [skipWarning, setSkipWarning] = useState(false);

  const resetAndClose = useCallback(() => {
    setOpen(false);
    setStage("details");
    setError("");
    setCreatedPropertyId(null);
    setQueuedImages([]);
    setQueuedVideo(null);
    setUploaded({ images: 0, video: false });
    setStage2Pending({ images: 0, video: false });
    setSkipWarning(false);
    setForm({
      projectName: "", developer: "", propertyType: "APARTMENT", bhk: "", city: "", locality: "",
      priceMinInr: "", priceMaxInr: "", areaSqft: "", description: "",
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/properties", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          bhk: form.bhk ? Number(form.bhk) : undefined,
          priceMinInr: Number(form.priceMinInr || 0),
          priceMaxInr: Number(form.priceMaxInr || 0),
          areaSqft: form.areaSqft ? Number(form.areaSqft) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.property?.id) {
        setError(data.error ?? "Unable to create the property. Please check the details and try again.");
        return;
      }
      // Stage 2: media can only be attached to the created property. The
      // files picked in stage 1 ride along (queuedImages/queuedVideo) and are
      // uploaded as soon as this stage mounts.
      setCreatedPropertyId(data.property.id);
      setStage("media");
      setSkipWarning(false);
      router.refresh();
    } catch {
      setError("Unable to create the property. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const hasQueuedMedia = queuedImages.length > 0 || queuedVideo !== null;
  const pendingCount = stage2Pending.images + (stage2Pending.video ? 1 : 0);
  const uploadedAny = uploaded.images > 0 || uploaded.video;
  // "done" only when nothing is still queued AND something actually landed.
  const mediaStatus: "pending" | "done" | "none" =
    pendingCount > 0 ? "pending" : uploadedAny ? "done" : "none";

  function finish() {
    if (pendingCount > 0) {
      // Never silently drop selected files: say exactly what is missing.
      setSkipWarning(true);
      return;
    }
    resetAndClose();
    router.refresh();
  }

  function skipMedia() {
    resetAndClose();
    router.refresh();
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md bg-brand text-white px-4 py-2 text-sm font-medium hover:opacity-90">
        + Add property
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => stage === "media" ? undefined : resetAndClose()}>
          {stage === "details" && (
            <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="bg-panel rounded-lg p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
              <h2 className="font-semibold text-ink">Add a property</h2>
              <input required placeholder="Project name" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm" />
              <input placeholder="Developer" value={form.developer} onChange={(e) => setForm({ ...form, developer: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.propertyType} onChange={(e) => setForm({ ...form, propertyType: e.target.value })} className="rounded-md border border-line px-3 py-2 text-sm">
                  {["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input placeholder="BHK" type="number" value={form.bhk} onChange={(e) => setForm({ ...form, bhk: e.target.value })}
                  className="rounded-md border border-line px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="rounded-md border border-line px-3 py-2 text-sm" />
                <input required placeholder="Locality" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })}
                  className="rounded-md border border-line px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="Min price (₹)" type="number" value={form.priceMinInr} onChange={(e) => setForm({ ...form, priceMinInr: e.target.value })}
                  className="rounded-md border border-line px-3 py-2 text-sm" />
                <input required placeholder="Max price (₹)" type="number" value={form.priceMaxInr} onChange={(e) => setForm({ ...form, priceMaxInr: e.target.value })}
                  className="rounded-md border border-line px-3 py-2 text-sm" />
              </div>
              <input placeholder="Area (sqft)" type="number" value={form.areaSqft} onChange={(e) => setForm({ ...form, areaSqft: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm" />
              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-md border border-line px-3 py-2 text-sm" rows={3} />

              {/* Media controls are part of the FIRST screen of the journey:
                  pickers + previews + remove work before the record exists and
                  the files are uploaded right after it is created. */}
              <div className="rounded-md border border-line p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <ImagePlus size={15} className="text-brand" aria-hidden />
                  <Film size={15} className="text-brand" aria-hidden />
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate">
                    Photos &amp; video <span className="normal-case tracking-normal">(optional)</span>
                  </p>
                </div>
                <PropertyMediaUpload
                  mode="select"
                  propertyId="new-property"
                  initialImages={[]}
                  initialVideoUrl={null}
                  initialVideoPosterUrl={null}
                  onSelectionChange={(images, video) => {
                    setQueuedImages(images);
                    setQueuedVideo(video);
                  }}
                />
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={resetAndClose} className="px-3 py-1.5 text-sm text-slate2">Cancel</button>
                <button disabled={saving} type="submit" className="px-3 py-1.5 text-sm rounded-md bg-brand text-white disabled:opacity-60">
                  {saving ? "Saving…" : hasQueuedMedia ? "Add property & upload media" : "Add property"}
                </button>
              </div>
              {hasQueuedMedia && (
                <p className="text-xs text-slate">
                  {queuedImages.length > 0 ? `${queuedImages.length} photo${queuedImages.length !== 1 ? "s" : ""}` : ""}
                  {queuedImages.length > 0 && queuedVideo ? " and " : ""}
                  {queuedVideo ? "1 video" : ""} selected — uploaded automatically once the property is created.
                </p>
              )}
            </form>
          )}

          {stage === "media" && createdPropertyId && (
            <div onClick={(e) => e.stopPropagation()} className="bg-panel rounded-lg p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-ink flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-green-500" />
                    Property created
                  </h2>
                  <p className="mt-1 text-sm text-slate">
                    <span className="font-medium text-ink">{form.projectName}</span> is now in your inventory. Add photos and a
                    video so buyers can see it at its best.
                  </p>
                </div>
              </div>

              {/* Explicit two-part status: creation succeeded; media is
                  pending / uploaded / not selected — never ambiguous. */}
              <ul className="rounded-md border border-line p-3 text-xs space-y-1.5">
                <li className="flex items-center gap-2 text-green-500">
                  <CheckCircle2 size={13} aria-hidden /> Property record created
                </li>
                <li className={`flex items-center gap-2 ${mediaStatus === "done" ? "text-green-500" : "text-slate"}`}>
                  {mediaStatus === "done" ? <CheckCircle2 size={13} aria-hidden /> : <AlertCircle size={13} aria-hidden />}
                  {mediaStatus === "done"
                    ? `Media uploaded${uploaded.images > 0 ? ` — ${uploaded.images} photo${uploaded.images !== 1 ? "s" : ""}` : ""}${uploaded.video ? " + video" : ""}`
                    : mediaStatus === "pending"
                      ? `Media queued — uploading ${pendingCount} file${pendingCount !== 1 ? "s" : ""}`
                      : "Media not added yet — you can add photos and a video below, or skip"}
                </li>
              </ul>

              <PropertyMediaUpload
                propertyId={createdPropertyId}
                initialImages={[]}
                initialVideoUrl={null}
                initialVideoPosterUrl={null}
                initialPendingImages={queuedImages}
                initialPendingVideo={queuedVideo}
                autoUploadOnMount={hasQueuedMedia}
                onSelectionChange={(images, video) =>
                  setStage2Pending({ images: images.length, video: video !== null })
                }
                onUploaded={(info) =>
                  setUploaded((prev) =>
                    info.kind === "video" ? { ...prev, video: true } : { ...prev, images: info.count }
                  )
                }
              />

              {skipWarning && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>
                    {stage2Pending.images > 0 && `${stage2Pending.images} photo${stage2Pending.images !== 1 ? "s" : ""} still queued. `}
                    {stage2Pending.video && "1 video still queued. "}
                    Upload them now, or remove them — otherwise they will not be saved with this property.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => {
                    const id = createdPropertyId;
                    resetAndClose();
                    router.push(`/properties/${id}`);
                  }}
                  className="text-sm text-slate2 hover:text-ink underline-offset-4 hover:underline"
                >
                  View property
                </button>
                <div className="flex items-center gap-2">
                  {(stage2Pending.images > 0 || stage2Pending.video) && (
                    <button
                      type="button"
                      onClick={skipMedia}
                      className="px-3 py-1.5 text-sm text-slate2 hover:text-ink"
                    >
                      Skip for now
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={finish}
                    className="px-4 py-2 text-sm rounded-md bg-brand text-white hover:opacity-90"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
