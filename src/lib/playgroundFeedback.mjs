export const PLAYGROUND_ACTION_UNAVAILABLE = 'This action is unavailable in the playground.';
export const PLAYGROUND_PUBLISH_UNAVAILABLE = 'Publishing is unavailable in the playground. Use Save to keep edits in this browser.';

export function showPlaygroundNotice(message) {
  window.dispatchEvent(new CustomEvent('vcd:edit-toast', { detail: { message, icon: 'info' } }));
}
