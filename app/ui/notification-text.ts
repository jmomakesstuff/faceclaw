import { type AndroidNotification } from "../native/notification-icons";

/**
 * Which text a notification is shown by. Kept apart from the drawing code
 * because both the list and the detail card need the same answers, and when
 * they each worked it out for themselves they drifted: the card labelled a
 * notification "(untitled)" while the list, one screen away, showed the very
 * same notification's body text and read fine.
 *
 * Pure string handling, so it is testable without a font or a screen.
 */

/**
 * The line a notification is identified by.
 *
 * Plenty of apps post with no title at all and put everything in the body, so
 * the fallback walks toward progressively less specific text rather than
 * giving up: a calendar reminder carrying only a time is still better shown as
 * that time than as a placeholder.
 */
export function notificationTitle(notification: AndroidNotification): string {
  return notification.title || notification.text || notification.summaryText
    || notification.appName || notification.packageName || "(untitled)";
}

/** The second line of a list row, blank when it would only repeat the headline. */
export function primaryNotificationBody(notification: AndroidNotification): string {
  const title = notificationTitle(notification);
  const body = notification.bigText || notification.text || notification.lines.join(" / ")
    || notification.summaryText || "";
  return body === title ? "" : body;
}

/** Everything the detail card can show below its headline. */
export function detailNotificationBody(notification: AndroidNotification): string {
  const lines = notification.lines.length ? notification.lines.join("\n") : "";
  return [notification.bigText || notification.text, lines].filter(Boolean).join("\n");
}

/**
 * What the detail card puts on screen. The body is dropped when the headline
 * already IS the body, which happens whenever a title-less notification falls
 * back to its own text; printing it twice is the cost of the fallback and this
 * is where that cost is paid.
 */
export function detailNotificationContent(
  notification: AndroidNotification,
): { title: string; body: string } {
  const title = notificationTitle(notification);
  const body = detailNotificationBody(notification);
  return { title, body: body === title ? "" : body };
}
