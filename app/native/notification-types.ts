/** Shared notification model; Android names are retained for existing callers. */
export type AndroidNotificationAction = { index: number; title: string; enabled: boolean };
export type AndroidNotification = {
  key: string; packageName: string; appName: string; title: string; text: string;
  bigText: string; subText: string; infoText: string; summaryText: string;
  category: string; lines: string[]; postTime: number; when: number;
  actions: AndroidNotificationAction[]; dismissLabel?: string;
  /**
   * The container Android posts to stand in for a bundle from one app. What it
   * represents is also posted in its own right, so it never opens a card.
   */
  isGroupSummary: boolean;
  /**
   * Android's mandatory "this app is running a foreground service" notification.
   * Addressed to the system rather than the wearer, so it never opens a card.
   */
  isForegroundService: boolean;
  /** Full message size reported by iOS, even when the fetched text is bounded. */
  messageSize?: number;
};
