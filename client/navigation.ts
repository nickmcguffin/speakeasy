// Changes the address without a page load. App listens for popstate, so it shows the new screen.
export function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
