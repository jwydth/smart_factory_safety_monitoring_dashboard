"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, ChevronUp, Signpost, X } from "lucide-react";
import { TrackingOverlay, TrackingOverlayFrame } from "@/types/detection";
import { FallLiveDetection } from "@/types/behavior";
import { PPESuggestion, ZoneSuggestion, type ZoneType } from "@/types/zone";
import { countLabel } from "@/lib/format";
import { ChipActionButton } from "@/components/ppe/detection-chip";
import {
  selectOverlayAtTimeWithDiagnostics,
  type OverlaySelection,
} from "@/lib/stream-timeline";

export function TrackingOverlayLayer({
  overlay,
  currentTime,
  behaviorDetections = [],
  behaviorEnabled = false,
  currentFrameIndex,
  currentSourceTimeMs,
  behaviorTtlFrames = 8,
  onPresentation,
}: {
  overlay?: TrackingOverlay;
  currentTime: number;
  behaviorDetections?: FallLiveDetection[];
  behaviorEnabled?: boolean;
  currentFrameIndex?: number;
  currentSourceTimeMs?: number | null;
  behaviorTtlFrames?: number;
  onPresentation?: (selection: OverlaySelection) => void;
}) {
  const selection = useCurrentBoxes(overlay, currentTime, currentSourceTimeMs);
  const currentBoxes = selection.frames;
  const mergedBoxes = mergeBehaviorDetections(
    currentBoxes,
    behaviorDetections,
    behaviorEnabled,
    currentFrameIndex,
    behaviorTtlFrames,
    currentSourceTimeMs,
  );
  const renderedSelection = useMemo(
    () => describeRenderedSelection(mergedBoxes, currentSourceTimeMs, selection),
    [currentSourceTimeMs, mergedBoxes, selection],
  );
  const frameWidth = overlay?.frame_width || 16;
  const frameHeight = overlay?.frame_height || 9;
  const aiDelayed = useMemo(() => {
    if (currentSourceTimeMs == null || !overlay?.frames.length) return false;
    const nearestDelta = Math.min(
      ...overlay.frames
        .filter((frame) => frame.source_time_ms !== undefined)
        .map((frame) => Math.abs((frame.source_time_ms ?? 0) - currentSourceTimeMs)),
    );
    return Number.isFinite(nearestDelta) && nearestDelta > 8 * 1000 / (overlay.fps || 24);
  }, [currentSourceTimeMs, overlay]);

  useEffect(() => {
    onPresentation?.(renderedSelection);
  }, [onPresentation, renderedSelection]);

  if (!overlay) return null;

  return (
    <>
      {mergedBoxes.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${frameWidth} ${frameHeight}`}
          preserveAspectRatio="none"
        >
          <TrackingBoxes
            frames={mergedBoxes}
            frameWidth={frameWidth}
            frameHeight={frameHeight}
          />
        </svg>
      ) : null}
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/65 px-2 py-1 text-xs font-semibold text-white ring-1 ring-white/10">
        {aiDelayed ? "AI delayed" : `Tracking ${countLabel(mergedBoxes.length, "worker")}`}
      </div>
    </>
  );
}

export function VideoTrackingOverlay({
  src,
  overlay,
}: {
  src: string;
  overlay?: TrackingOverlay;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const currentBoxes = useCurrentBoxes(overlay, currentTime).frames;
  const frameWidth = overlay?.frame_width || 16;
  const frameHeight = overlay?.frame_height || 9;

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const syncFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (!video.paused && !video.ended) {
      animationRef.current = requestAnimationFrame(syncFrame);
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-md border border-slate-800 bg-black"
      style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}
    >
      <video
        ref={videoRef}
        src={src}
        controls
        muted
        playsInline
        onPlay={syncFrame}
        onPause={syncFrame}
        onSeeked={syncFrame}
        onTimeUpdate={syncFrame}
        className="absolute inset-0 h-full w-full"
      />

      {overlay && currentBoxes.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${frameWidth} ${frameHeight}`}
          preserveAspectRatio="none"
        >
          <TrackingBoxes
            frames={currentBoxes}
            frameWidth={frameWidth}
            frameHeight={frameHeight}
          />
        </svg>
      ) : null}

      {overlay ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/65 px-2 py-1 text-xs font-semibold text-white ring-1 ring-white/10">
          Tracking {countLabel(currentBoxes.length, "worker")}
        </div>
      ) : null}
    </div>
  );
}

function useCurrentBoxes(
  overlay: TrackingOverlay | undefined,
  currentTime: number,
  currentSourceTimeMs?: number | null,
) {
  const sortedFrameIndexes = useMemo(() => {
    if (!overlay?.frames.length) return [];
    return Array.from(new Set(overlay.frames.map((frame) => frame.frame_index))).sort(
      (a, b) => a - b,
    );
  }, [overlay]);
  const framesByIndex = useMemo(() => {
    const grouped = new Map<number, TrackingOverlayFrame[]>();
    for (const frame of overlay?.frames ?? []) {
      grouped.set(frame.frame_index, [...(grouped.get(frame.frame_index) ?? []), frame]);
    }
    return grouped;
  }, [overlay]);
  const currentBoxes = useMemo(() => {
    if (!overlay || sortedFrameIndexes.length === 0) {
      return { frames: [], mode: "missing", signedSkewMs: null } satisfies OverlaySelection;
    }
    if (currentSourceTimeMs !== undefined) {
      return selectOverlayAtTimeWithDiagnostics(
        overlay.frames,
        currentSourceTimeMs ?? null,
        overlay.fps || 24,
      );
    }
    const currentFrame = Math.round(currentTime * overlay.fps);
    const nearestFrame = findNearestFrame(sortedFrameIndexes, currentFrame);
    if (nearestFrame === null) {
      return { frames: [], mode: "missing", signedSkewMs: null } satisfies OverlaySelection;
    }

    const tolerance = Math.max(overlay.stride || 1, 1) * 30; // Increased tolerance for slow inference
    if (Math.abs(nearestFrame - currentFrame) > tolerance) {
      return { frames: [], mode: "missing", signedSkewMs: null } satisfies OverlaySelection;
    }
    return {
      frames: framesByIndex.get(nearestFrame) ?? [],
      mode: "exact",
      signedSkewMs: null,
    } satisfies OverlaySelection;
  }, [currentSourceTimeMs, currentTime, framesByIndex, overlay, sortedFrameIndexes]);
  return currentBoxes;
}

function mergeBehaviorDetections(
  frames: TrackingOverlayFrame[],
  detections: FallLiveDetection[],
  behaviorEnabled: boolean,
  currentFrameIndex: number | undefined,
  ttlFrames: number,
  currentSourceTimeMs?: number | null,
): TrackingOverlayFrame[] {
  const merged = frames.map((frame) => ({ ...frame }));
  const visible = detections
    .filter((detection) => isVisibleBehaviorDetection(
      detection,
      currentFrameIndex,
      ttlFrames,
      currentSourceTimeMs,
    ))
    .sort(compareBehaviorRecency);

  for (const detection of visible) {
    const matchedIndex = findBehaviorMatch(merged, detection);
    const behavior: NonNullable<TrackingOverlayFrame["behavior"]> = {
      status: detection.status,
      score: detection.score,
      track_id: detection.track_id,
      source_time_ms: detection.source_time_ms,
    };
    if (matchedIndex >= 0) {
      const matched = merged[matchedIndex];
      if (!matched.behavior) {
        merged[matchedIndex] = { ...matched, behavior };
      }
      continue;
    }
    merged.push({
      frame_index: detection.frame_index ?? currentFrameIndex ?? 0,
      time_seconds: 0,
      track_id: detection.track_id,
      bbox: detection.bbox,
      confidence: detection.person_confidence,
      compliant: true,
      missing_equipment: [],
      status: "unknown",
      behavior,
      stream_epoch: detection.stream_epoch,
      media_pts_ms: detection.media_pts_ms,
      source_time_ms: detection.source_time_ms,
      inference_completed_ms: detection.inference_completed_ms,
      discontinuity_sequence: detection.discontinuity_sequence,
    });
  }
  return behaviorEnabled
    ? merged.map((frame) => frame.behavior ? frame : {
      ...frame,
      behavior: { status: "unknown", score: 0, track_id: frame.track_id },
    })
    : merged;
}

function isVisibleBehaviorDetection(
  detection: FallLiveDetection,
  currentFrameIndex: number | undefined,
  ttlFrames: number,
  currentSourceTimeMs?: number | null,
) {
  const { x1, y1, x2, y2 } = detection.bbox ?? {};
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return false;
  if (detection.is_stale || (detection.age_frames !== undefined && detection.age_frames > ttlFrames)) return false;
  if (currentSourceTimeMs != null && detection.source_time_ms !== undefined) {
    const ageMs = currentSourceTimeMs - detection.source_time_ms;
    return ageMs >= 0 && ageMs <= ttlFrames * 1000 / 24;
  }
  return detection.frame_index === undefined || currentFrameIndex === undefined
    ? true
    : Math.abs(currentFrameIndex - detection.frame_index) <= ttlFrames;
}

function findBehaviorMatch(frames: TrackingOverlayFrame[], detection: FallLiveDetection): number {
  const sameTrack = frames.findIndex(
    (frame) => frame.track_id !== undefined && frame.track_id === detection.track_id,
  );
  if (sameTrack >= 0) return sameTrack;
  let bestIndex = -1;
  let bestIou = 0.25;
  for (const [index, frame] of frames.entries()) {
    const iou = boxIou(frame.bbox, detection.bbox);
    if (iou > bestIou) {
      bestIou = iou;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function boxIou(a: TrackingOverlayFrame["bbox"], b: FallLiveDetection["bbox"]) {
  const overlapWidth = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const overlapHeight = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const overlap = overlapWidth * overlapHeight;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - overlap;
  return union > 0 ? overlap / union : 0;
}

function compareBehaviorRecency(a: FallLiveDetection, b: FallLiveDetection) {
  const aTime = a.source_time_ms ?? a.frame_index ?? 0;
  const bTime = b.source_time_ms ?? b.frame_index ?? 0;
  return bTime - aTime
    || behaviorPriority(b.status) - behaviorPriority(a.status)
    || b.score - a.score;
}

function describeRenderedSelection(
  frames: TrackingOverlayFrame[],
  currentSourceTimeMs: number | null | undefined,
  geometrySelection: OverlaySelection,
): OverlaySelection {
  if (currentSourceTimeMs == null || frames.length === 0) return geometrySelection;
  const sourceTimes = frames.flatMap((frame) => [
    frame.source_time_ms,
    frame.behavior?.source_time_ms,
  ]).filter((value): value is number => typeof value === "number");
  if (sourceTimes.length === 0) return geometrySelection;
  const signedSkewMs = sourceTimes
    .map((sourceTimeMs) => sourceTimeMs - currentSourceTimeMs)
    .reduce((worst, current) => Math.abs(current) > Math.abs(worst) ? current : worst, 0);
  return {
    frames: geometrySelection.frames,
    mode: Math.abs(signedSkewMs) > 0.5 ? "held" : geometrySelection.mode,
    signedSkewMs,
  };
}

function behaviorPriority(status: NonNullable<TrackingOverlayFrame["behavior"]>["status"]) {
  return status === "falling" ? 3 : status === "running" ? 2 : status === "others" ? 1 : 0;
}

function TrackingBoxes({
  frames,
  frameWidth,
  frameHeight,
}: {
  frames: TrackingOverlayFrame[];
  frameWidth: number;
  frameHeight: number;
}) {
  return (
    <>
      {frames.map((frame, index) => {
        const labels = trackingLabels(frame);
        const color = trackingColor(frame);
        const width = Math.max(0, frame.bbox.x2 - frame.bbox.x1);
        const height = Math.max(0, frame.bbox.y2 - frame.bbox.y1);
        const panelWidth = Math.min(
          frameWidth - frame.bbox.x1,
          Math.max(
            frameWidth * 0.22,
            Math.max(...labels.map((label) => label.length)) * frameWidth * 0.008,
          ),
        );
        const lineHeight = frameHeight * 0.032;
        const panelHeight = lineHeight * labels.length + frameHeight * 0.018;
        const panelY =
          frame.bbox.y1 > panelHeight + frameHeight * 0.012
            ? frame.bbox.y1 - panelHeight - frameHeight * 0.008
            : Math.min(frameHeight - panelHeight, frame.bbox.y2 + frameHeight * 0.008);
        const panelX = Math.min(frame.bbox.x1, frameWidth - panelWidth);

        return (
          <g key={`${frame.frame_index}-${frame.track_id ?? frame.person_id ?? index}-${index}`}>
            <rect
              x={frame.bbox.x1}
              y={frame.bbox.y1}
              width={width}
              height={height}
              fill="transparent"
              stroke={color}
              strokeWidth={Math.max(frameWidth, frameHeight) * 0.004}
            />
            <rect
              x={panelX}
              y={panelY}
              width={panelWidth}
              height={panelHeight}
              rx={frameWidth * 0.006}
              fill="rgba(2, 6, 23, 0.88)"
              stroke={color}
              strokeWidth={Math.max(frameWidth, frameHeight) * 0.0015}
            />
            <text
              x={panelX + frameWidth * 0.008}
              y={panelY + lineHeight * 0.85}
              fill="#ffffff"
              fontSize={frameHeight * 0.022}
              fontWeight={700}
            >
              {labels.map((label, labelIndex) => (
                <tspan
                  key={label}
                  x={panelX + frameWidth * 0.008}
                  dy={labelIndex === 0 ? 0 : lineHeight}
                  fill={color}
                >
                  {label}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </>
  );
}

function trackingLabels(frame: TrackingOverlayFrame): string[] {
  const labels: string[] = [];
  if (frame.missing_equipment.length > 0) {
    labels.push(`PPE: ${ppeViolationLabel(frame.missing_equipment)}`);
  }
  if (frame.zone_type) {
    const zoneLabel =
      frame.zone_type === "RESTRICTED"
        ? "Restricted zone"
        : frame.zone_type === "SLIPPERY"
        ? "Slippery area"
        : "Walkway violation";
    labels.push(`Zone: ${frame.zone_name ? `${zoneLabel} - ${frame.zone_name}` : zoneLabel}`);
  }
  const behavior = frame.behavior?.status;
  if (behavior === "running" || behavior === "falling") {
    labels.push(`Behavior: ${behavior[0].toUpperCase() + behavior.slice(1)}`);
  } else if (behavior === "unknown") {
    // Not "this person is behaving normally" — it is "the classifier has no
    // verdict for this person". fall_detector emits status "unknown" for any
    // track whose 60-sample window has not filled, which is 2.5s of unbroken
    // tracking under one track_id; a new id from a tracker switch restarts
    // that from zero. Someone running across the frame frequently never gets
    // there, so this state is common exactly when it matters most.
    //
    // It carries its own line rather than qualifying the fallback below, so
    // it composes with a PPE or zone finding instead of replacing it, and so
    // that "assessed as normal" (`others`, which adds nothing here and falls
    // through to Compliant) stays distinguishable from "not assessed".
    // Matches the label fall_detector's own warm-up comment names.
    labels.push("Behavior: Unknown");
  }
  if (labels.length === 0) {
    labels.push(complianceLabel(frame));
  }
  return labels;
}

/** The label for a person with nothing flagged against them at all.
 *
 * "Compliant" is an assertion, and it used to be made for anything short of an
 * outright violation — including `status: "unknown"`, where the PPE verdict
 * itself is undecided. Reaching this function now means every check that ran
 * came back clean, so the remaining job is to not let an undecided PPE verdict
 * borrow the word.
 */
function complianceLabel(frame: TrackingOverlayFrame): string {
  if (frame.status === "violation") return "Violation";
  if (frame.status === "unknown") return "Unknown";
  return "Compliant";
}

function formatEquipmentLabel(label: string): string {
  if (label === "Role Uniform") return "Role Uniform (Vest or Cleaning Coverall)";
  return label;
}

function ppeViolationLabel(missingEquipment: string[]): string {
  const normalized = new Set(missingEquipment.map((item) => item.trim().toLowerCase()));
  const hasHelmet = ["helmet", "hardhat", "safety helmet"].some((item) => normalized.has(item));
  const hasVest = ["vest", "safety vest"].some((item) => normalized.has(item));
  const hasCoverall = normalized.has("cleaning coverall");
  const hasUniform = normalized.has("role uniform");
  if (hasHelmet && hasVest) return "Missing Helmet and Vest";
  if (hasHelmet && hasCoverall) return "Missing Helmet and Cleaning Coverall";
  if (hasHelmet && hasUniform) return "Missing Helmet and Role Uniform";
  if (hasHelmet) return "Missing Safety Helmet";
  if (hasVest) return "Missing Safety Vest";
  if (hasCoverall) return "Missing Cleaning Coverall";
  if (hasUniform) return "Missing Role Uniform";
  return `Missing ${missingEquipment.map(formatEquipmentLabel).join(" and ")}`;
}

function trackingColor(frame: TrackingOverlayFrame): string {
  if (frame.missing_equipment.length > 0 || frame.status === "violation") {
    return "#ef4444";
  }
  if (frame.zone_type) return "#ef4444";
  if (frame.behavior?.status === "falling" || frame.behavior?.status === "running") {
    return "#ef4444";
  }
  return "#84cc16";
}

const SIGN_HUMAN_NAMES: Record<string, string> = {
  M001_MustWearHardHat: "Must Wear Hard Hat",
  M002_MustWearSafetyVest: "Must Wear Safety Vest",
  P004_NoThoroughfare: "No Thoroughfare",
  W011_Slippery: "Slippery",
};

const ZONE_TYPE_LABELS: Record<ZoneType, string> = {
  RESTRICTED: "Restricted zone",
  SLIPPERY: "Slippery zone",
  WALKWAY: "Walkway zone",
  IGNORE: "Ignored area",
};

/**
 * Every sign suggestion (a zone sign or a PPE sign) in one layer, split so
 * nothing the model is pointing at gets covered:
 *
 * - On the video: a dashed highlight plus a small numbered tag placed next to
 *   the sign, clear of every sign in frame (see placeTags). The old chip was
 *   anchored to the zone polygon's top edge — which is the sign's bottom edge
 *   (auto_zone.derive_zone_polygon) — and translated up by its own height,
 *   which parked a name field and two buttons exactly on the sign.
 * - In a tray along the bottom: a row per suggestion, numbered like its tag,
 *   with the editable name and the actions. The tray docks on the side with
 *   less of the suggested zones and signs under it (chooseTraySide), so the
 *   zone being offered stays visible while the user decides; it collapses to
 *   a one-line header on demand; and hovering or focusing a row brightens
 *   that suggestion's highlight and tag on the video.
 *
 * Zone and PPE rows share the tray because two separately bottom-anchored
 * layers would stack on top of each other.
 */
export function SignSuggestionLayer({
  zoneSuggestions,
  ppeSuggestions,
  onAcceptZone,
  onDismissZone,
  onEnablePPE,
  onDismissPPE,
}: {
  zoneSuggestions: ZoneSuggestion[];
  ppeSuggestions: PPESuggestion[];
  onAcceptZone: (suggestion: ZoneSuggestion, name: string) => void;
  onDismissZone: (suggestion: ZoneSuggestion) => void;
  onEnablePPE: (suggestion: PPESuggestion) => void;
  onDismissPPE: (suggestion: PPESuggestion) => void;
}) {
  const [editableNames, setEditableNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setEditableNames((prev) => {
      const next = { ...prev };
      for (const s of zoneSuggestions) {
        if (!(s.suggestion_id in next)) {
          next[s.suggestion_id] = SIGN_HUMAN_NAMES[s.source_class] ?? s.source_class;
        }
      }
      return next;
    });
  }, [zoneSuggestions]);

  const zones = zoneSuggestions.filter((s) => s.normalized_coordinates.length >= 3);
  const total = zones.length + ppeSuggestions.length;
  const hasSuggestions = total > 0;
  const listId = useId();

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const setActive = (key: string, active: boolean) =>
    setActiveKey((current) => (active ? key : current === key ? null : current));
  const [collapsed, setCollapsed] = useState(false);

  // Accepting a suggestion removes its row at once (useAutoZoneSuggestions is
  // optimistic), so a pending state on the button would never be seen. A short
  // confirmation in the tray says the click landed instead.
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    },
    [],
  );
  const confirm = (message: string) => {
    if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    setConfirmation(message);
    confirmationTimer.current = setTimeout(() => setConfirmation(null), CONFIRMATION_MS);
  };

  // Tag placement is decided in pixels (a tag's size is fixed in px, the
  // frame's is not), so track the rendered frame size.
  const tagLayerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<StageSize | null>(null);
  useEffect(() => {
    const element = tagLayerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasSuggestions]);

  const zoneSignBoxes = zones.map((s) => s.bbox ?? zoneSignFallbackBox(s));
  const signBoxes = [...zoneSignBoxes, ...ppeSuggestions.map((s) => s.bbox)];
  // Sticky: the tray only moves when the other side is strictly better. On a
  // tie — e.g. the last zone suggestion was just accepted, leaving only PPE
  // signs — it stays put rather than jumping onto the zone just added (which
  // this layer can't see; it's drawn by ZoneOverlaySvg).
  const [traySide, setTraySide] = useState<TraySide>("left");
  const preferredSide = chooseTraySide(zones.map(polygonBounds), signBoxes);
  if (preferredSide !== null && preferredSide !== traySide) {
    setTraySide(preferredSide);
  }
  const names = [...zones, ...ppeSuggestions].map((s) => SIGN_HUMAN_NAMES[s.source_class] ?? s.source_class);
  // Read by screen readers whenever it changes: a new sign, a removed one, or
  // the confirmation after an action. Rendered even with no suggestions, since
  // a live region only announces changes to content it already had mounted.
  const announcement =
    confirmation ?? (hasSuggestions ? `${countLabel(total, "sign suggestion")}: ${names.join(", ")}.` : "");

  return (
    <>
      <p className="sr-only" role="status">
        {announcement}
      </p>

      {hasSuggestions ? (
        <>
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {zones.map((s) => {
              const pts = s.normalized_coordinates;
              const d =
                `M ${pts[0].x} ${pts[0].y} ` +
                pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ") +
                " Z";
              const active = activeKey === s.suggestion_id;
              return (
                <g key={s.suggestion_id}>
                  {/* Dark underlay: the sky dash alone drops to 1.9:1 against
                      bright sky and 2.7:1 against blue steel. */}
                  <path
                    d={d}
                    fill={active ? "rgba(56,189,248,0.3)" : "rgba(56,189,248,0.15)"}
                    stroke="rgba(2,6,23,0.85)"
                    strokeWidth={active ? 0.012 : 0.009}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={active ? "#7dd3fc" : "#38bdf8"}
                    strokeWidth={active ? 0.007 : 0.005}
                    strokeDasharray="0.02 0.01"
                  />
                </g>
              );
            })}
            {ppeSuggestions.map((s) => {
              const [x1, y1, x2, y2] = s.bbox;
              const active = activeKey === s.suggestion_id;
              const box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
              return (
                <g key={s.suggestion_id}>
                  <rect
                    {...box}
                    fill={active ? "rgba(56,189,248,0.25)" : "rgba(56,189,248,0.12)"}
                    stroke="rgba(2,6,23,0.85)"
                    strokeWidth={active ? 0.01 : 0.008}
                  />
                  <rect
                    {...box}
                    fill="none"
                    stroke={active ? "#7dd3fc" : "#38bdf8"}
                    strokeWidth={active ? 0.006 : 0.004}
                    strokeDasharray="0.015 0.008"
                  />
                </g>
              );
            })}
          </svg>

          {/* Visual only: every tag repeats text its tray row already exposes. */}
          <div ref={tagLayerRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
            {placeTags(
              [
                ...zones.map((s, index) => ({
                  key: s.suggestion_id,
                  number: index + 1,
                  label: names[index],
                  sign: zoneSignBoxes[index],
                })),
                ...ppeSuggestions.map((s, index) => ({
                  key: s.suggestion_id,
                  number: zones.length + index + 1,
                  label: names[zones.length + index],
                  sign: s.bbox,
                })),
              ],
              stageSize ?? FALLBACK_STAGE_SIZE,
              // Measure only once mounted, so the server render and the first
              // client render agree on tag positions.
              stageSize !== null,
            ).map((tag) => (
              <SuggestionTag
                key={tag.key}
                number={tag.number}
                label={tag.label}
                left={tag.left}
                top={tag.top}
                active={activeKey === tag.key}
              />
            ))}
          </div>
        </>
      ) : null}

      {hasSuggestions || confirmation ? (
        // Tray sits above the controls parked along the bottom edge of
        // LlHlsVideo — the "AI-generated demo footage" badge (bottom-3 left-3)
        // and the fullscreen button (bottom-3 right-3), ~46px together — and
        // above native <video> controls on the uploaded-file path. The wrapper
        // spans the frame (so max-h-[45%] has a height to resolve against) but
        // ignores the pointer; only the tray takes clicks. The width cap keeps
        // the opposite ~40% of the frame clear for the zone being suggested,
        // and on a wide feed (fullscreen) stops rows stretching edge to edge.
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 bottom-12 flex flex-col justify-end px-2 ${
            traySide === "right" ? "items-end" : "items-start"
          }`}
        >
          <section
            aria-label="Sign suggestions"
            className="pointer-events-auto flex max-h-[45%] w-full max-w-[min(48rem,62%)] flex-col gap-1.5"
          >
            {confirmation ? (
              <p className="detection-chip-enter flex items-center gap-1.5 rounded-md border border-emerald-400/50 bg-slate-950/95 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-black/40">
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                {confirmation}
              </p>
            ) : null}
            {hasSuggestions ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-sky-400/50 bg-slate-950/95 py-1 pr-1 pl-2.5 text-xs shadow-lg shadow-black/40">
                <span className="flex items-center gap-1.5 font-semibold text-white">
                  <Signpost className="size-3.5 shrink-0 text-sky-300" aria-hidden="true" />
                  {countLabel(total, "sign suggestion")}
                </span>
                <ChipActionButton
                  action={{
                    label: collapsed ? "Show" : "Hide",
                    icon: collapsed ? ChevronUp : ChevronDown,
                    onClick: () => setCollapsed((value) => !value),
                    expanded: !collapsed,
                    controls: listId,
                  }}
                />
              </div>
            ) : null}
            {hasSuggestions && !collapsed ? (
              <ul id={listId} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
                {zones.map((s, index) => {
                  const humanName = names[index];
                  const editableName = editableNames[s.suggestion_id] ?? humanName;
                  const inputId = `${listId}-zone-name-${index}`;
                  return (
                    <SuggestionRow
                      key={s.suggestion_id}
                      number={index + 1}
                      title={`${humanName} sign detected`}
                      detail={`${ZONE_TYPE_LABELS[s.zone_type] ?? s.zone_type} suggested`}
                      active={activeKey === s.suggestion_id}
                      onActiveChange={(active) => setActive(s.suggestion_id, active)}
                    >
                      <label htmlFor={inputId} className="text-slate-400">
                        Zone name
                      </label>
                      <input
                        id={inputId}
                        value={editableName}
                        onChange={(e) =>
                          setEditableNames((prev) => ({ ...prev, [s.suggestion_id]: e.target.value }))
                        }
                        className="h-7 w-36 rounded border border-slate-500 bg-slate-900 px-1.5 text-xs text-white outline-none focus-visible:border-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
                      />
                      <ChipActionButton
                        action={{
                          label: "Add zone",
                          icon: Check,
                          primary: true,
                          onClick: () => {
                            onAcceptZone(s, editableName);
                            confirm(`Zone "${editableName}" added`);
                          },
                        }}
                      />
                      <ChipActionButton action={{ label: "Dismiss", icon: X, onClick: () => onDismissZone(s) }} />
                    </SuggestionRow>
                  );
                })}
                {ppeSuggestions.map((s, index) => (
                  <SuggestionRow
                    key={s.suggestion_id}
                    number={zones.length + index + 1}
                    title={`${names[zones.length + index]} sign detected`}
                    detail="PPE Detection is off"
                    active={activeKey === s.suggestion_id}
                    onActiveChange={(active) => setActive(s.suggestion_id, active)}
                  >
                    <ChipActionButton
                      action={{
                        label: "Enable PPE Detection",
                        icon: Check,
                        primary: true,
                        onClick: () => {
                          onEnablePPE(s);
                          confirm("PPE Detection enabled");
                        },
                      }}
                    />
                    <ChipActionButton action={{ label: "Dismiss", icon: X, onClick: () => onDismissPPE(s) }} />
                  </SuggestionRow>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

function SuggestionNumber({ value }: { value: number }) {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded-full bg-sky-400 text-[10px] font-bold leading-none text-slate-950"
      aria-hidden="true"
    >
      {value}
    </span>
  );
}

/** Normalized x1, y1, x2, y2 in [0, 1]. */
type NormBox = [number, number, number, number];
type StageSize = { width: number; height: number };
type TraySide = "left" | "right";

const CONFIRMATION_MS = 4000;
// Used for the first render, before the ResizeObserver reports a size.
const FALLBACK_STAGE_SIZE: StageSize = { width: 960, height: 540 };
// SuggestionTag's rendered box: size-4 badge + py-0.5 + 1px border each side.
const TAG_HEIGHT_PX = 22;
const TAG_GAP_PX = 4;
// Badge, gap, padding and border around the label text.
const TAG_CHROME_PX = 32;

let tagMeasureContext: CanvasRenderingContext2D | null | undefined;

/** Tag width in px. Measures the label in the page's actual font; falls back to
 * a rounded-up estimate (~6.4px a character at 11px semibold) where there is
 * no canvas, e.g. during the server render. */
function tagWidthPx(label: string, measure: boolean): number {
  if (measure && typeof document !== "undefined") {
    if (tagMeasureContext === undefined) {
      tagMeasureContext = document.createElement("canvas").getContext("2d");
    }
    if (tagMeasureContext) {
      tagMeasureContext.font = `600 11px ${getComputedStyle(document.body).fontFamily}`;
      return Math.ceil(TAG_CHROME_PX + tagMeasureContext.measureText(label).width);
    }
  }
  return TAG_CHROME_PX + label.length * 6.4;
}

/** A zone suggestion from a backend that doesn't send the sign's box: the
 * sign sits directly above the zone polygon's top edge, centred on it. */
function zoneSignFallbackBox(suggestion: ZoneSuggestion): NormBox {
  const pts = suggestion.normalized_coordinates;
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const top = Math.min(...pts.map((p) => p.y));
  return [cx - 0.04, Math.max(0, top - 0.12), cx + 0.04, top];
}

function polygonBounds(suggestion: ZoneSuggestion): NormBox {
  const pts = suggestion.normalized_coordinates;
  return [
    Math.min(...pts.map((p) => p.x)),
    Math.min(...pts.map((p) => p.y)),
    Math.max(...pts.map((p) => p.x)),
    Math.max(...pts.map((p) => p.y)),
  ];
}

function boxesOverlap(a: NormBox, b: NormBox): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

// How much more a sign counts than zone area when docking the tray: covering
// the sign itself is the failure this layer exists to avoid.
const TRAY_SIGN_WEIGHT = 4;

/**
 * Docks the tray on whichever side it would cover less of the suggested
 * zones and signs. The tray spans at most 62% of the width from its side and
 * sits in the lower half of the frame, so each side is scored over that span.
 * Returns null on a tie, leaving the caller's current side in place.
 */
function chooseTraySide(zoneBounds: NormBox[], signBoxes: NormBox[]): TraySide | null {
  const coveredArea = (box: NormBox, from: number, to: number) =>
    Math.max(0, Math.min(box[2], to) - Math.max(box[0], from)) * Math.max(0, box[3] - Math.max(box[1], 0.5));
  const score = (from: number, to: number) =>
    zoneBounds.reduce((sum, box) => sum + coveredArea(box, from, to), 0) +
    signBoxes.reduce((sum, box) => sum + TRAY_SIGN_WEIGHT * coveredArea(box, from, to), 0);
  const left = score(0, 0.62);
  const right = score(0.38, 1);
  if (Math.abs(left - right) < 1e-6) return null;
  return right < left ? "right" : "left";
}

/**
 * Puts each tag beside its sign without covering any sign in frame or another
 * tag. Tries below, right, left, then above its own sign and takes the first
 * spot that is clear; if none is (a crowded frame), falls back to below.
 * Checking every sign — not just its own — matters because signs are often
 * mounted in a column on one post: a tag hung below the top sign lands on the
 * one beneath it.
 */
function placeTags(
  requests: { key: string; number: number; label: string; sign: NormBox }[],
  stage: StageSize,
  measure: boolean,
): { key: string; number: number; label: string; left: number; top: number }[] {
  const signs = requests.map((request) => request.sign);
  const placed: NormBox[] = [];
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(0, max));

  return requests.map((request) => {
    const w = tagWidthPx(request.label, measure) / Math.max(stage.width, 1);
    const h = TAG_HEIGHT_PX / Math.max(stage.height, 1);
    const gapX = TAG_GAP_PX / Math.max(stage.width, 1);
    const gapY = TAG_GAP_PX / Math.max(stage.height, 1);
    const [x1, y1, x2, y2] = request.sign;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const candidates = [
      [cx - w / 2, y2 + gapY], // below
      [x2 + gapX, cy - h / 2], // right
      [x1 - gapX - w, cy - h / 2], // left
      [cx - w / 2, y1 - gapY - h], // above
    ].map(([left, top]) => [clamp(left, 1 - w), clamp(top, 1 - h)] as const);

    const isClear = ([left, top]: readonly [number, number]) => {
      const box: NormBox = [left, top, left + w, top + h];
      return !signs.some((sign) => boxesOverlap(box, sign)) && !placed.some((tag) => boxesOverlap(box, tag));
    };
    const [left, top] = candidates.find(isClear) ?? candidates[0];
    placed.push([left, top, left + w, top + h]);
    return { key: request.key, number: request.number, label: request.label, left, top };
  });
}

/** Compact marker next to a sign, positioned by placeTags. Pointer-transparent,
 * so it never blocks the video underneath; the actions live in the tray row. */
function SuggestionTag({
  number,
  label,
  left,
  top,
  active,
}: {
  number: number;
  label: string;
  left: number;
  top: number;
  active: boolean;
}) {
  return (
    // Position on the outer element, animation on the inner one: the chip-in
    // keyframes animate `transform`, which would fight any positioning
    // transform on the same element.
    <div className="pointer-events-none absolute" style={{ left: `${left * 100}%`, top: `${top * 100}%` }}>
      <div
        className={`detection-chip-enter flex items-center gap-1 whitespace-nowrap rounded-full border bg-slate-950/85 py-0.5 pl-0.5 pr-2 text-[11px] font-semibold text-white shadow shadow-black/40 ${
          active ? "border-sky-300 ring-2 ring-sky-300/70" : "border-sky-400/60"
        }`}
      >
        <SuggestionNumber value={number} />
        {label}
      </div>
    </div>
  );
}

function SuggestionRow({
  number,
  title,
  detail,
  active,
  onActiveChange,
  children,
}: {
  number: number;
  title: string;
  detail: string;
  active: boolean;
  onActiveChange: (active: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <li
      onMouseEnter={() => onActiveChange(true)}
      onMouseLeave={() => onActiveChange(false)}
      onFocus={() => onActiveChange(true)}
      onBlur={(event) => {
        // Moving focus between the row's own controls keeps it active.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onActiveChange(false);
      }}
      className={`detection-chip-enter flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border bg-slate-950/95 px-2.5 py-1.5 text-xs shadow-lg shadow-black/40 ${
        active ? "border-sky-300" : "border-sky-400/50"
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <SuggestionNumber value={number} />
        <Signpost className="size-3.5 shrink-0 text-sky-300" aria-hidden="true" />
        <span className="font-semibold text-white">{title}</span>
        <span className="text-slate-400">{detail}</span>
      </span>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}

function findNearestFrame(frameIndexes: number[], target: number): number | null {
  if (frameIndexes.length === 0) return null;

  let low = 0;
  let high = frameIndexes.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = frameIndexes[mid];
    if (value === target) return value;
    if (value < target) low = mid + 1;
    else high = mid - 1;
  }

  const before = frameIndexes[Math.max(0, high)];
  const after = frameIndexes[Math.min(frameIndexes.length - 1, low)];
  return Math.abs((before ?? 0) - target) <= Math.abs((after ?? 0) - target)
    ? before
    : after;
}
