// Changes the address without a page load. App listens for popstate, so it shows the new screen.
export function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// What this tab knows about the room it shows: whether it created the room, and whether the link
// was saved (copied or shared). Kept in the history entry, not in storage, so it survives a
// refresh in this tab and never reaches other tabs.
export type RoomEntryState = { createdHere: boolean; linkSaved: boolean };

export function readRoomEntryState(): RoomEntryState {
  const state = history.state as Partial<RoomEntryState> | null;
  return { createdHere: state?.createdHere === true, linkSaved: state?.linkSaved === true };
}

export function updateRoomEntryState(changes: Partial<RoomEntryState>) {
  history.replaceState({ ...history.state, ...changes }, "");
}
