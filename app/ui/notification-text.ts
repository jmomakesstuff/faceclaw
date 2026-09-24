import { type AndroidNotification } from "../native/notification-types";

/**
 * Which text a notification is shown by. Kept apart from the drawing code
 * because the list and the detail card need the same answers, and when they
 * each worked it out for themselves they drifted: the card labelled a
 * notification "(untitled)" while the list, one screen away, showed that same
 * notification's body text and read fine.
 *
 * Pure string handling, so both surfaces can be checked against each other
 * without a font or a screen.
 */

/** Which field a headline was taken from, so a caller can avoid printing it twice. */
export type NotificationContentSource = "title" | "text" | "summaryText" | "lines" | "none";

export type NotificationContent = { text: string; source: NotificationContentSource };

/**
 * The text a notification actually carries, ignoring who sent it.
 *
 * Plenty of apps post with no title and put everything in the body, so this
 * walks toward progressively less specific fields rather than giving up: a
 * lock reporting an entry, a calendar reminder carrying only a time, and a
 * message bundle whose content is all in its lines are each better shown as
 * what they say than as a placeholder.
 *
 * `source` is what keeps a caller from rendering the same string twice, which
 * is the price of a fallback: whichever field the headline came from must not
 * be drawn again underneath it.
 */
export function notificationContent(notification: AndroidNotification): NotificationContent {
  if (notification.title) return { text: notification.title, source: "title" };
  if (notification.text) return { text: notification.text, source: "text" };
  if (notification.summaryText) return { text: notification.summaryText, source: "summaryText" };
  if (notification.lines.length) return { text: notification.lines.join(" / "), source: "lines" };
  return { text: "", source: "none" };
}

/**
 * The line a list row is headed by. A row always needs something on it, so a
 * notification with no content of its own falls back to naming its sender.
 * The detail card does NOT do this: it prints the sender on a line of its own,
 * so falling back there would simply say the same word twice.
 */
export function notificationTitle(notification: AndroidNotification): string {
  const content = notificationContent(notification);
  return content.text || notification.appName || notification.packageName || "(untitled)";
}

/** The second line of a list row, blank when it would only repeat the headline. */
export function primaryNotificationBody(notification: AndroidNotification): string {
  const title = notificationTitle(notification);
  const body = notification.bigText || notification.text || notification.lines.join(" / ")
    || notification.summaryText || "";
  return body === title ? "" : body;
}

/**
 * What the detail card puts on screen, with every part that would repeat the
 * headline already removed.
 *
 * Each of the three blocks can collide with the headline, and each collides
 * differently: the body repeats it when the headline came from the text, the
 * line list repeats it when the headline came from the lines, and the meta row
 * repeats it when the headline came from the summary text. Comparing whole
 * joined strings catches only the first of those, which is why the source is
 * tracked rather than inferred.
 */
export function detailNotificationContent(notification: AndroidNotification): {
  title: string;
  body: string;
  meta: string;
} {
  const content = notificationContent(notification);

  // bigText is kept even when the headline came from text, because it is the
  // longer form of the same thing rather than a repeat of it.
  const primary = notification.bigText || notification.text;
  const bodyParts: string[] = [];
  if (primary && primary !== content.text) bodyParts.push(primary);
  if (notification.lines.length && content.source !== "lines") {
    bodyParts.push(notification.lines.join("\n"));
  }

  const meta = [notification.subText, notification.infoText, notification.summaryText]
    .filter(Boolean)
    .filter((value) => value !== content.text)
    .join("  ");

  return { title: content.text, body: bodyParts.join("\n"), meta };
}
