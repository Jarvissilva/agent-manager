import { Skeleton } from '@/components/ui/skeleton';
import { createBrowserRouter, redirect } from 'react-router';
import Home, { homeLoader } from './pages/Home';
import { homeAction } from './actions/homeAction';
import Sessions, { sessionsLoader } from './pages/Sessions';
import Schedules, { schedulesLoader } from './pages/Schedules';
import AppLayout, { projectsLoader } from './layouts/AppLayout';
import NewProject, { newProjectAction } from './pages/NewProject';
import Projects from './pages/Projects';
import { projectsAction } from './actions/projectAction';
import Session, { sessionLoader, sessionAction } from './pages/Session';
import ErrorBoundary from './pages/ErrorBoundary';
import Agents, { agentsLoader } from './pages/Agents';
import NewAgent, { newAgentAction, newAgentLoader } from './pages/NewAgent';
import EditAgent, { agentLoader, editAgentAction } from './pages/EditAgent';
import Skills, { skillsLoader } from './pages/Skills';
import NewSkill, { newSkillAction } from './pages/NewSkill';
import EditSkill, { skillLoader, editSkillAction } from './pages/EditSkill';
import {
  legacyRunLoader,
  legacyJobsLoader,
  legacyProjectWorkLoader,
} from './lib/legacyNavigation';
import Schedule, { scheduleLoader, scheduleAction } from './pages/Schedule';
const router = createBrowserRouter([
  {
    path: '/',
    id: 'app',
    Component: AppLayout,
    loader: projectsLoader,
    ErrorBoundary,
    HydrateFallback: () => (
      <main
        className="mx-auto w-full max-w-3xl space-y-5 px-5 py-24"
        role="status"
        aria-label="Loading workspace"
      >
        <Skeleton className="mx-auto size-12 rounded-2xl" />
        <Skeleton className="mx-auto h-8 w-2/3" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <span className="sr-only">Loading projects…</span>
      </main>
    ),
    children: [
      { path: 'jobs', loader: legacyJobsLoader },
      { path: 'jobs/new', loader: () => redirect('/schedules/new') },
      { path: 'jobs/:jobId', loader: legacyJobsLoader },
      { path: 'runs', loader: () => redirect('/schedules') },
      { path: 'runs/:runId', loader: legacyRunLoader },
      { path: 'schedules', Component: Schedules, loader: schedulesLoader },
      {
        path: 'schedules/new',
        Component: Schedule,
        loader: scheduleLoader,
        action: scheduleAction,
      },
      {
        path: 'schedules/:scheduleId',
        Component: Schedule,
        loader: scheduleLoader,
        action: scheduleAction,
      },
      { index: true, loader: () => redirect('/sessions') },
      { path: 'home', Component: Home, loader: homeLoader, action: homeAction },
      { path: 'sessions', Component: Sessions, loader: sessionsLoader },
      {
        path: 'sessions/new',
        Component: Session,
        loader: sessionLoader,
        action: sessionAction,
      },
      {
        path: 'sessions/:sessionId',
        Component: Session,
        loader: sessionLoader,
        action: sessionAction,
      },
      { path: 'projects', Component: Projects, action: projectsAction },
      { path: 'projects/new', Component: NewProject, action: newProjectAction },
      {
        path: 'projects/:projectSlug',
        loader: () => redirect('/projects'),
      },
      {
        path: 'projects/:projectSlug/schedules/new',
        loader: legacyProjectWorkLoader,
      },
      {
        path: 'projects/:projectSlug/schedules/:scheduleId',
        loader: legacyProjectWorkLoader,
      },
      {
        path: 'projects/:projectSlug/chat',
        loader: legacyProjectWorkLoader,
      },
      {
        path: 'projects/:projectSlug/sessions/:sessionId',
        loader: legacyProjectWorkLoader,
      },
      { path: 'providers', loader: () => redirect('/') },
      { path: 'settings', loader: () => redirect('/') },
      { path: 'settings/providers', loader: () => redirect('/') },
      { path: 'agents', Component: Agents, loader: agentsLoader },
      {
        path: 'agents/new',
        Component: NewAgent,
        loader: newAgentLoader,
        action: newAgentAction,
      },
      {
        path: 'agents/:agentId',
        Component: EditAgent,
        loader: agentLoader,
        action: editAgentAction,
      },
      { path: 'skills', Component: Skills, loader: skillsLoader },
      { path: 'skills/new', Component: NewSkill, action: newSkillAction },
      {
        path: 'skills/:skillId',
        Component: EditSkill,
        loader: skillLoader,
        action: editSkillAction,
      },
    ],
  },
]);
export default router;
