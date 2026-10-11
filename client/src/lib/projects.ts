import { redirect } from 'react-router';
import { api } from './api';

export type Project = {
  id: number;
  name: string;
  paths: string[];
  sessionCount: number;
  activeSessionCount: number;
  scheduleCount: number;
  slug: string;
};

export function projectSlugs(projects: Omit<Project, 'slug'>[]): Project[] {
  const used = new Set(['new']);
  const slugs = new Map<number, string>();
  for (const project of [...projects].sort((a, b) => a.id - b.id)) {
    const name = project.name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const base =
      !name || /^\d+$/.test(name) ? `project-${name || project.id}` : name;
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) slug = `${base}-${suffix++}`;
    used.add(slug);
    slugs.set(project.id, slug);
  }
  return projects.map((project) => ({
    ...project,
    slug: slugs.get(project.id)!,
  }));
}

export async function loadProjects(signal: AbortSignal) {
  return projectSlugs(await api<Omit<Project, 'slug'>[]>('/projects', signal));
}

export async function resolveProject(
  value: string | undefined,
  request: Request,
  canonical = true,
) {
  const projects = await loadProjects(request.signal);
  const project = projects.find(
    (project) => project.slug === value || String(project.id) === value,
  );
  if (!project) throw new Response('Project not found.', { status: 404 });
  if (canonical && value !== project.slug) {
    const url = new URL(request.url);
    throw redirect(
      url.pathname.replace(/^\/projects\/[^/]+/, `/projects/${project.slug}`) +
        url.search,
    );
  }
  return project;
}
