import type { TNotification } from "@plane/types";

/** Keep the initial inbox quiet and never replay older unread items after reads or filter changes. */
export class NotificationAlertTracker {
  private initialized = false;
  private latest = "";
  private seen = new Set<string>();

  ingest(notifications: TNotification[]): TNotification[] {
    const fresh = this.initialized
      ? notifications.filter((item) => !!item.created_at && item.created_at >= this.latest && !this.seen.has(item.id))
      : [];
    for (const item of notifications) {
      if (!item.created_at) continue;
      if (item.created_at > this.latest) {
        this.latest = item.created_at;
        this.seen.clear();
      }
      if (item.created_at === this.latest) this.seen.add(item.id);
    }
    this.initialized = true;
    return fresh;
  }
}

const trackers = new Map<string, NotificationAlertTracker>();
export function notificationAlertTracker(scope: string) {
  if (!trackers.has(scope)) trackers.set(scope, new NotificationAlertTracker());
  return trackers.get(scope)!;
}

export function notificationSoundEnabled(userId: string): boolean {
  try {
    return localStorage.getItem(`notification-sound:${userId}`) === "true";
  } catch {
    return false;
  }
}

export function saveNotificationSound(userId: string, enabled: boolean) {
  localStorage.setItem(`notification-sound:${userId}`, String(enabled));
}

let audioContext: AudioContext | undefined;
export async function playNotificationSound() {
  try {
    if (typeof window === "undefined" || !window.AudioContext) return;
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();
    if (audioContext.state !== "running") return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(740, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime + 0.12);
    gain.gain.setValueAtTime(0.07, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
    oscillator.addEventListener(
      "ended",
      () => {
        oscillator.disconnect();
        gain.disconnect();
      },
      { once: true }
    );
  } catch (error) {
    console.debug("Notification sound unavailable", error);
  }
}

export function notificationTarget(workspaceSlug: string, notification: TNotification) {
  const moduleId = notification.data?.module?.id;
  if (moduleId && notification.project) return `/${workspaceSlug}/projects/${notification.project}/modules/${moduleId}`;
  return `/${workspaceSlug}/notifications`;
}
