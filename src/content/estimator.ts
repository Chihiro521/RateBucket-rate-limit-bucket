import type { PlatformId, UsageSnapshot } from "../platforms/types";
import {
  getEstimateState,
  incrementEstimateState,
  type EstimateState
} from "../storage/cache";

type EstimateCallback = (snapshot: UsageSnapshot) => void;

export function installSendEstimator(
  platform: PlatformId,
  onEstimate: EstimateCallback
): () => void {
  let lastIncrementAt = 0;

  const increment = (): void => {
    const now = Date.now();
    if (now - lastIncrementAt < 1_200) {
      return;
    }
    lastIncrementAt = now;
    void incrementEstimateState(platform).then((state) => {
      onEstimate(snapshotFromEstimate(platform, state));
    });
  };

  const onClick = (event: MouseEvent): void => {
    if (isLikelySendButton(event.target)) {
      increment();
    }
  };

  const onSubmit = (): void => {
    increment();
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);

  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("submit", onSubmit, true);
  };
}

export async function getEstimateSnapshot(
  platform: PlatformId
): Promise<UsageSnapshot | null> {
  const state = await getEstimateState(platform);
  if (!state || state.sentCount <= 0) {
    return null;
  }
  return snapshotFromEstimate(platform, state);
}

function snapshotFromEstimate(
  platform: PlatformId,
  state: EstimateState
): UsageSnapshot {
  return {
    platform,
    meters: [
      {
        key: "local:sent-count",
        label: "Sent locally",
        used: state.sentCount,
        source: "estimate",
        confidence: "low",
        rawKind: "localEstimate"
      }
    ],
    source: "estimate",
    updatedAt: state.lastSentAt,
    status: "unknown",
    errorMessage: "Using local estimate only"
  };
}

function isLikelySendButton(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const button = target.closest("button,[role='button']");
  if (!button) {
    return false;
  }
  const label = [
    button.getAttribute("aria-label"),
    button.getAttribute("title"),
    button.getAttribute("data-testid"),
    button.textContent
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return /\bsend\b|发送|submit|composer-submit|send-button/.test(label);
}
