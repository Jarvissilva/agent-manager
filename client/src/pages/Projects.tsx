import { useEffect, useRef } from 'react';
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';

type Project = {
  id: number;
  name: string;
  path: string;
};

export async function projectsLoader({ request }: LoaderFunctionArgs) {
  const response = await fetch('/api/projects', { signal: request.signal });

  if (!response.ok) {
    throw new Error('Could not load projects. Please try again.');
  }

  const projects: Project[] = await response.json();
  return projects;
}

export async function projectsAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const selectingDirectory = formData.get('intent') === 'select-directory';
  const failureMessage = selectingDirectory
    ? 'Could not select a folder. Please try again.'
    : 'Could not add project. Please try again.';

  try {
    const response = await fetch(
      selectingDirectory ? '/api/projects/select-directory' : '/api/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: selectingDirectory
          ? undefined
          : JSON.stringify({
              name: formData.get('name'),
              path: formData.get('path'),
            }),
        signal: request.signal,
      },
    );
    const result: Project | { path: string | null } | { error: string } =
      await response.json();

    if (!response.ok || 'error' in result) {
      return {
        error: 'error' in result ? result.error : failureMessage,
      };
    }

    if (selectingDirectory && !('id' in result)) {
      return { path: result.path };
    }

    if (!('id' in result)) {
      throw new Error('Invalid project response');
    }

    return { project: result };
  } catch (error) {
    if (request.signal.aborted) {
      throw error;
    }

    return { error: failureMessage };
  }
}

export default function Projects() {
  const projects = useLoaderData<typeof projectsLoader>();
  const actionData = useActionData<typeof projectsAction>();
  const navigation = useNavigation();
  const saving = navigation.state !== 'idle';
  const form = useRef<HTMLFormElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const folderPicker = useFetcher<typeof projectsAction>();
  const selectingDirectory = folderPicker.state !== 'idle';

  useEffect(() => {
    if (typeof folderPicker.data?.path === 'string' && pathInput.current) {
      pathInput.current.value = folderPicker.data.path;
    }
  }, [folderPicker.data]);

  useEffect(() => {
    if (actionData?.project) {
      form.current?.reset();
    }
  }, [actionData]);

  return (
    <main>
      <header>
        <p className="eyebrow">Agent Manager</p>
        <h1>Projects</h1>
        <p>Register the directories where you work.</p>
      </header>

      <section aria-labelledby="add-project-title">
        <h2 id="add-project-title">Add a project</h2>
        <Form method="post" ref={form}>
          <label htmlFor="project-name">Name</label>
          <input
            id="project-name"
            name="name"
            placeholder="Acme"
            required
            disabled={saving}
          />

          <label htmlFor="project-path">Directory path</label>
          <input
            id="project-path"
            name="path"
            ref={pathInput}
            placeholder="No folder selected"
            aria-describedby="path-help"
            spellCheck={false}
            required
            readOnly
            disabled={saving}
          />
          <p id="path-help" className="hint">
            Choose the folder where you want your agents to work.
          </p>

          <button
            type="button"
            disabled={saving || selectingDirectory}
            onClick={() =>
              void folderPicker.submit(
                { intent: 'select-directory' },
                { method: 'post' },
              )
            }
          >
            {selectingDirectory ? 'Choosing…' : 'Choose folder'}
          </button>
          {!selectingDirectory && folderPicker.data?.error && (
            <p role="alert" className="error">
              {folderPicker.data.error}
            </p>
          )}

          <button disabled={saving || selectingDirectory}>
            {saving ? 'Adding…' : 'Add project'}
          </button>
          {!saving && actionData?.error && (
            <p role="alert" className="error">
              {actionData.error}
            </p>
          )}
          <p role="status" className="notice">
            {!saving && actionData?.project
              ? `Added ${actionData.project.name}.`
              : ''}
          </p>
        </Form>
      </section>

      <section aria-labelledby="saved-projects-title">
        <h2 id="saved-projects-title">Saved projects</h2>
        {projects.length === 0 ? (
          <p>No projects yet. Add your first project above.</p>
        ) : (
          <ul className="projects">
            {projects.map((project) => (
              <li key={project.id}>
                <h3>{project.name}</h3>
                <code>{project.path}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
