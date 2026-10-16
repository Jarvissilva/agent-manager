import { getUsage } from './controllers/usage.js';
import { getAppSettings, patchAppSettings } from './controllers/settings.js';
import {
  getDiscoveredSkills,
  postImportedSkill,
} from './controllers/skill/importSkill.js';
import {
  getSavedSession,
  updateSessionDetails,
} from './controllers/session/details.js';
import createSession from './controllers/session/createSession.js';
import deleteSession from './controllers/session/deleteSession.js';
import { Router, raw } from 'express';
import { getFiles, selectFile, uploadFile } from './controllers/files.js';
import {
  getChat,
  updateChatQueue,
  postMessage,
  interruptChat,
  respondToChat,
} from './controllers/session/chat.js';
import createProject from './controllers/project/createProject.js';
import deleteProject from './controllers/project/deleteProject.js';
import updateProject from './controllers/project/updateProject.js';
import getProjects from './controllers/project/getProjects.js';
import selectDirectory from './controllers/project/selectDirectory.js';
import getProviders from './controllers/provider/getProviders.js';
import getModels from './controllers/provider/getModels.js';
import getAgents from './controllers/agent/getAgents.js';
import getAgent from './controllers/agent/getAgent.js';
import createAgent from './controllers/agent/createAgent.js';
import updateAgent from './controllers/agent/updateAgent.js';
import deleteAgent from './controllers/agent/deleteAgent.js';
import getSkills from './controllers/skill/getSkills.js';
import getSkill from './controllers/skill/getSkill.js';
import createSkill from './controllers/skill/createSkill.js';
import updateSkill from './controllers/skill/updateSkill.js';
import deleteSkill from './controllers/skill/deleteSkill.js';
import {
  getSessions,
  getScheduleSessions,
  getLegacySession,
  cancelSession,
} from './controllers/session/history.js';
import {
  getSchedules,
  getSchedule,
  postSchedule,
  putSchedule,
  removeSchedule,
  previewSchedule,
} from './controllers/schedule/schedules.js';
import { isAllowedOrigin } from './lib/security/requestOrigin.js';
import type { Request, Response, NextFunction } from 'express';
import {
  getProjectSession,
  stopProjectSession,
} from './controllers/session/projectSession.js';

const router = Router();
function localWrite(request: Request, response: Response, next: NextFunction) {
  if (request.headers.origin && !isAllowedOrigin(request)) {
    response.status(403).json({
      error: 'This request must come from a trusted dashboard origin.',
    });
    return;
  }
  next();
}

router.get('/usage', getUsage);
router.use('/files', (request, response, next) => {
  if (!isAllowedOrigin(request)) {
    response.status(403).json({
      error: 'This request must come from a trusted dashboard origin.',
    });
    return;
  }
  next();
});
router.post('/files/browse', getFiles);
router.post('/files/reference', selectFile);
router.post(
  '/files/uploads',
  raw({ type: 'application/octet-stream', limit: '20mb' }),
  uploadFile,
);
router.get('/settings', getAppSettings);
router.patch('/settings', localWrite, patchAppSettings);

router.get('/projects', getProjects);
router.post('/projects', createProject);
router.patch('/projects/:projectId', localWrite, updateProject);
router.delete('/projects/:projectId', localWrite, deleteProject);
router.post('/projects/select-directory', selectDirectory);
router.get('/providers', getProviders);
router.get('/providers/:providerId/models', getModels);
router.get('/agents', getAgents);
router.post('/agents', createAgent);
router.get('/agents/:agentId', getAgent);
router.put('/agents/:agentId', updateAgent);
router.delete('/agents/:agentId', deleteAgent);
router.get('/skills', getSkills);
router.post('/skills', createSkill);
router.get('/skills/discover', getDiscoveredSkills);
router.post('/skills/import', localWrite, postImportedSkill);
router.post('/skills/select-directory', localWrite, selectDirectory);
router.get('/skills/:skillId', getSkill);
router.put('/skills/:skillId', updateSkill);
router.delete('/skills/:skillId', deleteSkill);
router.get('/projects/:projectId/session', getProjectSession);
router.post('/projects/:projectId/session', localWrite, createSession);
router.delete('/projects/:projectId/session', stopProjectSession);
router.get('/sessions', getSessions);
router.post('/sessions', localWrite, createSession);
router.get('/sessions/:sessionId', getSavedSession);
router.patch('/sessions/:sessionId', localWrite, updateSessionDetails);
router.delete('/sessions/:sessionId', localWrite, deleteSession);
router.post('/sessions/:sessionId/resume', localWrite, createSession);
router.get('/sessions/:sessionId/chat', getChat);
router.patch('/sessions/:sessionId/queue', localWrite, updateChatQueue);
router.post('/sessions/:sessionId/messages', localWrite, postMessage);
router.post('/sessions/:sessionId/interrupt', localWrite, interruptChat);
router.post(
  '/sessions/:sessionId/requests/:requestId',
  localWrite,
  respondToChat,
);

router.get('/legacy/runs/:runId', getLegacySession);
router.post('/sessions/:sessionId/cancel', localWrite, cancelSession);
router.get('/schedules/:scheduleId/sessions', getScheduleSessions);
router.get('/schedules', getSchedules);
router.post('/schedules/preview', localWrite, previewSchedule);
router.post('/schedules', localWrite, postSchedule);
router.get('/schedules/:scheduleId', getSchedule);
router.put('/schedules/:scheduleId', localWrite, putSchedule);
router.delete('/schedules/:scheduleId', localWrite, removeSchedule);

export default router;
