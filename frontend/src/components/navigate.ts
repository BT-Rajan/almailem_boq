/** Go to a hash route ('#/projects/...'). The one place the UI changes location. */
export function navigate(hash: string): void {
  window.location.hash = hash;
}
