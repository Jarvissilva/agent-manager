import { createBrowserRouter } from 'react-router';
import Projects, { projectsAction, projectsLoader } from './pages/Projects';
import ErrorBoundary from './pages/ErrorBoundary';

const router = createBrowserRouter([
  {
    path: '/',
    Component: Projects,
    loader: projectsLoader,
    action: projectsAction,
    ErrorBoundary,
    HydrateFallback: () => (
      <main>
        <p role="status">Loading projects…</p>
      </main>
    ),
  },
]);

export default router;
