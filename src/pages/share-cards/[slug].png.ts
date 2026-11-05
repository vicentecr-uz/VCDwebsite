import type { APIRoute } from 'astro';
import { isWriteupProject, loadAllProjects, loadProjectBySlug, shouldIncludeProjectInBuild } from '../../lib/projects';
import { renderWriteupShareCard, writeupPublicationDate } from '../../lib/writeupShareCard';

export const prerender = import.meta.env.PROD;

export function getStaticPaths() {
  return loadAllProjects()
    .filter((project) => isWriteupProject(project) && shouldIncludeProjectInBuild(project))
    .map(({ slug }) => ({ params: { slug } }));
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug ?? '';
  if (!/^[a-z0-9-]+$/.test(slug)) return new Response(null, { status: 404 });
  const project = loadProjectBySlug(slug);
  if (!project || !isWriteupProject(project) || !shouldIncludeProjectInBuild(project)) {
    return new Response(null, { status: 404 });
  }

  const png = await renderWriteupShareCard(project.title, writeupPublicationDate(project.sections));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
