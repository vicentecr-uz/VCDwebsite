export function usesCompactEditor(root = document.documentElement) {
  return root.hasAttribute('data-compact-editor')
    || (root.classList.contains('is-remote-editor') && matchMedia('(max-width: 40em)').matches);
}
