import { useRouteLoaderData } from 'react-router';
import type { projectsLoader } from '../layouts/AppLayout';
import ProjectList from '../components/ProjectList';

export default function Projects() {
  const projects =
    useRouteLoaderData<typeof projectsLoader>('app')?.projects ?? [];
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Manage your projects here. Find your work in Sessions and Automations.
        </p>
      </header>
      <ProjectList projects={projects} />
    </main>
  );
}
