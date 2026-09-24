/** Shared notification model; Android names are retained for existing callers. */
export type AndroidNotificationAction = { index: number; title: string; enabled: boolean };
export type AndroidNotification = {
  key: string; packageName: string; appName: string; title: string; text: string;
  bigText: string; subText: string; infoText: string; summaryText: string;
  category: string; lines: string[]; postTime: number; when: number;
  actions: AndroidNotificationAction[]; dismissLabel?: string;
  /** The bundle container Android posts alongside the notifications it stands for. */
  isGroupSummary: boolean;
  /** Full message size reported by iOS, even when the fetched text is bounded. */
  messageSize?: number;
};
