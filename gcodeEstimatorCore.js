(function attachMachTileGcodeEstimatorCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileGcodeEstimatorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileGcodeEstimatorCore() {
  "use strict";

  const AXIS_NAMES = ["x", "y", "z", "a", "b", "c"];

  function positiveNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeAxis(axis, fallbackRate, fallbackAcceleration) {
    return {
      maxRateMmMin: positiveNumber(axis?.maxRateMmMin ?? axis?.max_rate_mm_min) || fallbackRate,
      accelerationMmSec2: positiveNumber(axis?.accelerationMmSec2 ?? axis?.acceleration_mm_sec2)
        || fallbackAcceleration,
    };
  }

  function createMachineProfile(input = {}) {
    const rapidRateMmMin = positiveNumber(input.rapidRateMmMin ?? input.rapidRate) || 60000;
    const maxFeedRateMmMin = positiveNumber(input.maxFeedRateMmMin ?? input.maxFeedRate);
    const accelerationMmSec2 = positiveNumber(input.accelerationMmSec2 ?? input.acceleration);
    const axes = {};

    for (const name of AXIS_NAMES) {
      const axisInput = input.axes?.[name] ?? input.axes?.[name.toUpperCase()];
      if (axisInput || accelerationMmSec2) {
        axes[name] = normalizeAxis(axisInput, rapidRateMmMin, accelerationMmSec2);
      }
    }

    return {
      rapidRateMmMin,
      maxFeedRateMmMin,
      accelerationMmSec2,
      axes,
      hasAcceleration: Boolean(
        accelerationMmSec2
        || Object.values(axes).some((axis) => positiveNumber(axis.accelerationMmSec2)),
      ),
    };
  }

  function pathLimits(distanceMm, deltas, profile, requestedRateMmMin, rapid) {
    let maxRateMmMin = rapid
      ? profile.rapidRateMmMin
      : (profile.maxFeedRateMmMin || requestedRateMmMin);
    let accelerationMmSec2 = profile.accelerationMmSec2;
    const normalizedDeltas = {};

    for (const [rawName, rawDelta] of Object.entries(deltas || {})) {
      const name = String(rawName).toLowerCase();
      const delta = Math.abs(Number(rawDelta));
      if (!AXIS_NAMES.includes(name) || !Number.isFinite(delta) || delta <= 0) continue;
      normalizedDeltas[name] = delta;
      const ratio = delta / distanceMm;
      const axis = profile.axes[name];
      if (!axis || ratio <= 0) continue;
      const axisRate = positiveNumber(axis.maxRateMmMin);
      const axisAcceleration = positiveNumber(axis.accelerationMmSec2);
      if (axisRate) maxRateMmMin = Math.min(maxRateMmMin, axisRate / ratio);
      if (axisAcceleration) {
        const pathAcceleration = axisAcceleration / ratio;
        accelerationMmSec2 = accelerationMmSec2
          ? Math.min(accelerationMmSec2, pathAcceleration)
          : pathAcceleration;
      }
    }

    return {
      maxRateMmMin,
      accelerationMmSec2,
      deltas: normalizedDeltas,
    };
  }

  // Conservative segment model: every G-code motion segment starts and ends at rest.
  // Short segments use a triangular profile; longer segments use a trapezoidal profile.
  function estimateMotionSeconds(input = {}) {
    const distanceMm = positiveNumber(input.distanceMm);
    const requestedRateMmMin = positiveNumber(input.requestedRateMmMin);
    if (!distanceMm || !requestedRateMmMin) {
      return {
        seconds: 0,
        model: "invalid",
        phase: "none",
        distanceMm: distanceMm || 0,
        effectiveRateMmMin: 0,
        accelerationMmSec2: null,
      };
    }

    const profile = input.profile?.rapidRateMmMin
      ? input.profile
      : createMachineProfile(input.profile || {});
    const limits = pathLimits(
      distanceMm,
      input.deltas,
      profile,
      requestedRateMmMin,
      input.rapid === true,
    );
    const effectiveRateMmMin = Math.min(requestedRateMmMin, limits.maxRateMmMin);
    const velocityMmSec = effectiveRateMmMin / 60;
    const accelerationMmSec2 = positiveNumber(limits.accelerationMmSec2);

    if (!accelerationMmSec2) {
      return {
        seconds: distanceMm / velocityMmSec,
        model: "constant-speed",
        phase: "cruise",
        distanceMm,
        effectiveRateMmMin,
        accelerationMmSec2: null,
      };
    }

    const accelerationDistanceMm = (velocityMmSec * velocityMmSec) / accelerationMmSec2;
    const triangular = distanceMm <= accelerationDistanceMm;
    const seconds = triangular
      ? 2 * Math.sqrt(distanceMm / accelerationMmSec2)
      : distanceMm / velocityMmSec + velocityMmSec / accelerationMmSec2;

    return {
      seconds,
      model: "acceleration-aware",
      phase: triangular ? "triangular" : "trapezoidal",
      distanceMm,
      effectiveRateMmMin,
      accelerationMmSec2,
    };
  }

  function median(values) {
    const sorted = values
      .map(Number)
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // Calibration is advisory until an explicit minimum sample count is configured.
  // It deliberately keeps the raw estimate separate from the historical suggestion.
  function summarizeCalibration(samples = [], input = {}) {
    const valid = (Array.isArray(samples) ? samples : []).map((sample) => {
      const actualSeconds = positiveNumber(sample?.actualSeconds ?? sample?.actual_seconds);
      const estimatedSeconds = positiveNumber(sample?.estimatedSeconds ?? sample?.estimated_seconds);
      if (!actualSeconds || !estimatedSeconds) return null;
      return {
        actualSeconds,
        estimatedSeconds,
        ratio: actualSeconds / estimatedSeconds,
      };
    }).filter(Boolean);
    const sampleCount = valid.length;
    const correctionFactor = median(valid.map((sample) => sample.ratio));
    const medianActualSeconds = median(valid.map((sample) => sample.actualSeconds));
    const rawEstimateSeconds = positiveNumber(input.rawEstimateSeconds ?? input.raw_estimate_seconds);
    const minimumSamples = positiveNumber(input.minimumSamples ?? input.minimum_samples);
    const ready = Boolean(minimumSamples && sampleCount >= minimumSamples && correctionFactor);
    const status = !sampleCount
      ? "no-samples"
      : !minimumSamples
        ? "threshold-not-configured"
        : ready
          ? "ready"
          : "collecting";

    return {
      status,
      ready,
      sampleCount,
      minimumSamples,
      correctionFactor,
      medianActualSeconds,
      rawEstimateSeconds,
      suggestedSeconds: correctionFactor && rawEstimateSeconds
        ? rawEstimateSeconds * correctionFactor
        : null,
    };
  }

  // Read-only evidence review. It groups eligible samples by machine and reports
  // missing evidence without inventing an outlier rule or changing source data.
  function buildCalibrationReview(samples = [], input = {}) {
    const programId = String(input.programId ?? input.program_id ?? "").trim();
    const currentMachineId = String(input.currentMachineId ?? input.current_machine_id ?? "").trim();
    const rawEstimateSeconds = positiveNumber(input.rawEstimateSeconds ?? input.raw_estimate_seconds);
    const minimumSamples = positiveNumber(input.minimumSamples ?? input.minimum_samples);
    const groups = new Map();
    const rejected = [];
    let scopedSampleCount = 0;

    (Array.isArray(samples) ? samples : []).forEach((sample, index) => {
      const sampleProgramId = String(sample?.programId ?? sample?.program_id ?? "").trim();
      if (programId && sampleProgramId !== programId) return;
      scopedSampleCount += 1;

      const machineId = String(sample?.machineId ?? sample?.machine_id ?? "").trim();
      const actualSeconds = positiveNumber(sample?.actualSeconds ?? sample?.actual_seconds);
      const estimatedSeconds = positiveNumber(sample?.estimatedSeconds ?? sample?.estimated_seconds);
      const normalized = {
        sampleId: String(sample?.sampleId ?? sample?.sample_id ?? sample?.id ?? `sample-${index + 1}`),
        machineId,
        machineLabel: String(sample?.machineLabel ?? sample?.machine_label ?? (machineId || "未指定機台")),
        programVersionId: String(sample?.programVersionId ?? sample?.program_version_id ?? ""),
        versionLabel: String(sample?.versionLabel ?? sample?.version_label ?? "未連結程式版"),
        runDate: String(sample?.runDate ?? sample?.run_date ?? sample?.created_at ?? ""),
        source: String(sample?.source ?? "unknown"),
        remark: String(sample?.remark ?? ""),
        actualSeconds,
        estimatedSeconds,
        ratio: actualSeconds && estimatedSeconds ? actualSeconds / estimatedSeconds : null,
      };

      let reason = "";
      if (!machineId) reason = "missing-machine";
      else if (!actualSeconds) reason = "missing-actual";
      else if (!estimatedSeconds) reason = "missing-estimate";

      if (reason) {
        rejected.push({ ...normalized, reason });
        return;
      }

      const group = groups.get(machineId) || {
        machineId,
        machineLabel: normalized.machineLabel,
        isCurrentMachine: Boolean(currentMachineId && currentMachineId === machineId),
        samples: [],
      };
      group.samples.push(normalized);
      groups.set(machineId, group);
    });

    const normalizedGroups = [...groups.values()].map((group) => {
      group.samples.sort((left, right) => String(right.runDate).localeCompare(String(left.runDate)));
      const summary = summarizeCalibration(group.samples, { rawEstimateSeconds, minimumSamples });
      return { ...group, ...summary };
    }).sort((left, right) => {
      if (left.isCurrentMachine !== right.isCurrentMachine) return left.isCurrentMachine ? -1 : 1;
      return left.machineLabel.localeCompare(right.machineLabel);
    });

    const rejectedCounts = rejected.reduce((counts, sample) => {
      counts[sample.reason] = (counts[sample.reason] || 0) + 1;
      return counts;
    }, {});

    return {
      programId,
      scopedSampleCount,
      eligibleSampleCount: normalizedGroups.reduce((total, group) => total + group.sampleCount, 0),
      rejectedSampleCount: rejected.length,
      rejectedCounts,
      groups: normalizedGroups,
      rejected,
    };
  }

  return {
    createMachineProfile,
    estimateMotionSeconds,
    summarizeCalibration,
    buildCalibrationReview,
  };
});
