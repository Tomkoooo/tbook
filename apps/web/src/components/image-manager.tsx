"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, Crop, GripVertical, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Notice } from "@/components/notice";
import { cn } from "@/lib/utils";

/**
 * Product images: upload (with a crop step), re-crop, reorder by dragging
 * (mouse or touch) or with the arrow buttons, and remove. The first image
 * is the main one. Cropping happens on the server from the original, so
 * re-cropping never loses quality.
 */

const ASPECTS = [
  { label: "1:1", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 },
  { label: "Free", value: null },
] as const;

interface CropJob {
  /** Object URL of the picture being cropped. */
  src: string;
  /** A new upload, or the path of an existing image being re-cropped. */
  file?: File;
  existingPath?: string;
}

export function ImageManager({
  images,
  onChange,
  disabled,
  max = 20,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [job, setJob] = useState<CropJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Open the cropper for the next queued upload.
  useEffect(() => {
    if (job || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setJob({ src: URL.createObjectURL(next!), file: next });
  }, [job, queue]);

  function closeJob() {
    if (job) URL.revokeObjectURL(job.src);
    setJob(null);
  }

  async function finishCrop(crop: Area | null) {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      let path: string;
      if (job.file) {
        const form = new FormData();
        form.set("file", job.file);
        if (crop) form.set("crop", JSON.stringify(crop));
        path = await postJson("/admin/media/upload", { method: "POST", body: form });
        onChange([...images, path]);
      } else {
        path = await postJson("/admin/media/crop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: job.existingPath, crop }),
        });
        onChange(images.map((image) => (image === job.existingPath ? path : image)));
      }
      closeJob();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function recrop(path: string) {
    setError(null);
    const response = await fetch(`/admin/media/original?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      setError("The original of this image isn't available; upload it again to crop it.");
      return;
    }
    setJob({ src: URL.createObjectURL(await response.blob()), existingPath: path });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChange(arrayMove(images, images.indexOf(String(active.id)), images.indexOf(String(over.id))));
  }

  const move = (index: number, by: number) => onChange(arrayMove(images, index, index + by));
  const canAdd = !disabled && images.length + queue.length < max;

  return (
    <div className="grid gap-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={images} strategy={rectSortingStrategy}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {images.map((image, index) => (
              <SortableImage
                key={image}
                src={image}
                index={index}
                count={images.length}
                disabled={disabled}
                onMove={move}
                onRemove={() => onChange(images.filter((i) => i !== image))}
                onCrop={image.startsWith("/media/") ? () => recrop(image) : undefined}
                onMakeMain={() => onChange([image, ...images.filter((i) => i !== image)])}
              />
            ))}
            {canAdd ? (
              <li>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm transition-colors"
                >
                  <ImagePlus className="size-6" />
                  Add images
                </button>
              </li>
            ) : null}
          </ul>
        </SortableContext>
      </DndContext>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).slice(0, max - images.length);
          setQueue((current) => [...current, ...files]);
          event.target.value = "";
        }}
      />
      <p className="text-muted-foreground text-xs">
        Drag to reorder (or use the arrows). The first image is the main one. JPG, PNG, WebP or HEIC, up to 15 MB — saved as optimised WebP.
      </p>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <CropDialog job={job} busy={busy} remaining={queue.length} onCancel={closeJob} onDone={finishCrop} />
    </div>
  );
}

async function postJson(url: string, init: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as { path?: string; error?: { message?: string } } | null;
  if (!response.ok || !body?.path) throw new Error(body?.error?.message ?? "Upload failed.");
  return body.path;
}

function SortableImage({
  src,
  index,
  count,
  disabled,
  onMove,
  onRemove,
  onCrop,
  onMakeMain,
}: {
  src: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (index: number, by: number) => void;
  onRemove: () => void;
  onCrop?: () => void;
  onMakeMain: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: src, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("bg-card group relative overflow-hidden rounded-lg border", isDragging && "ring-primary z-10 opacity-80 ring-2")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded/external product images */}
      <img src={src} alt="" className="aspect-square w-full object-cover" draggable={false} />
      {index === 0 ? (
        <Badge variant="info" className="absolute top-2 left-2">
          Main
        </Badge>
      ) : null}
      {disabled ? null : (
        <>
          <button
            type="button"
            aria-label="Drag to reorder"
            className="bg-background/90 absolute top-2 right-2 cursor-grab touch-none rounded-md p-1.5 shadow-sm active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <div className="bg-background/90 absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 p-1">
            <div className="flex">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Move left" disabled={index === 0} onClick={() => onMove(index, -1)}>
                <ChevronLeft />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Move right" disabled={index === count - 1} onClick={() => onMove(index, 1)}>
                <ChevronRight />
              </Button>
            </div>
            <div className="flex">
              {index > 0 ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Make main image" onClick={onMakeMain}>
                  <Star />
                </Button>
              ) : null}
              {onCrop ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Crop" onClick={onCrop}>
                  <Crop />
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove image" className="text-destructive hover:text-destructive" onClick={onRemove}>
                <Trash2 />
              </Button>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

function CropDialog({
  job,
  busy,
  remaining,
  onCancel,
  onDone,
}: {
  job: CropJob | null;
  busy: boolean;
  remaining: number;
  onCancel: () => void;
  onDone: (crop: Area | null) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<number | null>(1);
  const [area, setArea] = useState<Area | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, [job?.src]);

  return (
    <Dialog open={job !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{job?.file ? "Crop image" : "Re-crop image"}</DialogTitle>
          <DialogDescription>
            Drag to position, pinch or use the slider to zoom.{remaining > 0 ? ` ${remaining} more image(s) waiting.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Shape">
          {ASPECTS.map((option) => (
            <Button
              key={option.label}
              type="button"
              size="sm"
              role="radio"
              aria-checked={aspect === option.value}
              variant={aspect === option.value ? "default" : "outline"}
              onClick={() => setAspect(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div className="relative h-80 overflow-hidden rounded-md bg-black sm:h-96">
          {job ? (
            <Cropper
              image={job.src}
              crop={crop}
              zoom={zoom}
              aspect={aspect ?? (natural ? natural.width / natural.height : 1)}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              onMediaLoaded={(size) => setNatural({ width: size.naturalWidth, height: size.naturalHeight })}
              objectFit="contain"
            />
          ) : null}
        </div>
        <Slider min={1} max={4} step={0.01} value={[zoom]} aria-label="Zoom" onValueChange={([value]) => setZoom(value ?? 1)} />
        <DialogFooter className="gap-2">
          {job?.file ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onDone(null)}>
              Use without cropping
            </Button>
          ) : null}
          <Button type="button" disabled={busy || !area} onClick={() => onDone(area)}>
            {busy ? <Loader2 className="animate-spin" /> : <Crop />} {busy ? "Saving…" : "Crop and save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
