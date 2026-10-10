export type CropResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface CropStageParts {
  ghost: HTMLDivElement;
  ghostImg: HTMLImageElement;
  stage: HTMLDivElement;
  handles: HTMLElement[];
}

const RESIZE_DIRECTIONS: CropResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Build the dynamic on-page crop surface shared by the editor and demos. */
export function createImageCropStage(options: {
  src: string;
  background?: string;
  document?: Document;
}): CropStageParts {
  const document = options.document ?? globalThis.document;
  const ghost = document.createElement('div');
  ghost.className = 'dev-crop-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  const ghostImg = document.createElement('img');
  ghostImg.alt = '';
  ghostImg.draggable = false;
  ghostImg.src = options.src;
  if (options.background) ghostImg.style.backgroundColor = options.background;
  ghost.append(ghostImg);

  const stage = document.createElement('div');
  stage.className = 'dev-crop-stage';
  const handles = RESIZE_DIRECTIONS.map((direction) => {
    const handle = document.createElement('span');
    handle.className = `dev-crop-stage__handle dev-crop-stage__handle--${direction}`;
    handle.dataset.pageResize = direction;
    handle.setAttribute('aria-hidden', 'true');
    stage.append(handle);
    return handle;
  });

  return { ghost, ghostImg, stage, handles };
}

export function cropResizeHeight(direction: CropResizeDirection, width: number, height: number, dx: number, dy: number, minHeight = width / 5, maxHeight = width / (9 / 16)) {
  let next = height;
  if (direction.includes('n')) next = height - dy;
  else if (direction.includes('s')) next = height + dy;
  else {
    const impliedWidth = direction === 'e' ? width + dx : width - dx;
    next = height * width / Math.max(1, impliedWidth);
  }
  return Math.min(maxHeight, Math.max(minHeight, next));
}
