/* Garlo AI Selling — modules/notify.js (v7)
   Thin wrapper around chrome.notifications. No icon files required — uses an
   inline base64 PNG so the extension stays "load unpacked, no assets".
   Never throws: a failed notification must never break the queue or watcher. */

const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function notify(id, title, message) {
  try {
    if (!chrome.notifications || !chrome.notifications.create) return;
    await chrome.notifications.create(String(id || ('garlo-' + Date.now())), {
      type: 'basic',
      iconUrl: ICON,
      title: String(title || 'Garlo AI Selling'),
      message: String(message || ''),
      priority: 0
    });
  } catch {
    /* Permission missing, notification quota hit, or platform disallows —
       swallow. Notifications are a nicety, not a hard requirement. */
  }
}