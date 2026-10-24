/**
 * The longest wait the front accepts from a Retry-After, in milliseconds, and so the longest
 * the API may ask for. The API refuses at boot a rate-limit window longer than this (a 429's
 * Retry-After lasts until the window ends), so a Retry-After from our own server never goes
 * past it, whatever the configuration; the front caps any other at it.
 */
export const MAX_RETRY_AFTER_MS = 60_000;
