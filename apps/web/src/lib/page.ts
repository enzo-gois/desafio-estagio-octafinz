/** Its own module so tests can replace it: jsdom implements no navigation. */
export function reloadPage(): void {
  window.location.reload();
}
