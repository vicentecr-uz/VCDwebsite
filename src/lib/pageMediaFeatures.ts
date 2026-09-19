import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

export interface PageMediaFeatures {
  gallery: boolean;
  captions: boolean;
  lightbox: boolean;
  video: boolean;
}

export function getPageMediaFeatures(html: string): PageMediaFeatures {
  const features: PageMediaFeatures = {
    gallery: false,
    captions: false,
    lightbox: false,
    video: false,
  };
  const root = parseFragment(html);

  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    const tagName = 'tagName' in node ? node.tagName : node.nodeName;
    const attrs = new Map('attrs' in node ? node.attrs.map(({ name, value }) => [name, value]) : []);
    const classes = new Set((attrs.get('class') ?? '').split(/\s+/).filter(Boolean));

    features.gallery ||= classes.has('project-grid');
    features.captions ||= classes.has('project-caption');
    features.lightbox ||= tagName === 'img' && Boolean(attrs.get('data-image-original')?.trim());
    features.video ||= tagName === 'video' && attrs.has('data-project-inline-video');

    if ('content' in node) node.content.childNodes.forEach(visit);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };

  root.childNodes?.forEach(visit);
  return features;
}
