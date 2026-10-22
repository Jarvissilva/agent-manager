import { newChatDefaults } from '../../services/settings.js';
import type { Request, Response } from 'express';
import { positiveId, RequestError } from '../../lib/http/errors.js';
import {
  workingDirectory,
  requireWorkingDirectory,
} from '../../lib/directories.js';
import { validateChatSettings } from '../../services/chatSettings.js';
import { startSession, withSessionActivity } from '../../services/sessions.js';
import {
  findSavedSession,
  findSessionById,
} from '../../repositories/sessions.js';
import { findProject } from '../../repositories/projects.js';
import { conversationIdPattern } from '../../lib/providers/codex/conversation.js';
import { findAgent, type Agent } from '../../services/agents.js';

export default async function createSession(
  request: Request,
  response: Response,
) {
  const scoped = request.params.projectId !== undefined;
  const scopedId = scoped
    ? positiveId(request.params.projectId, 'project')
    : null;
  if (scopedId !== null && !findProject(scopedId))
    throw new RequestError(404, 'Project not found.');
  const resumeId = request.params.sessionId ?? request.body?.resumeSessionId;
  const saved =
    typeof resumeId === 'string' ? findSessionById(resumeId) : undefined;
  let projectId: number | null = scopedId;
  if (!scoped) {
    if (resumeId !== undefined) {
      if (!saved) throw new RequestError(404, 'Session not found.');
      projectId = saved.projectId;
      if (
        request.body?.projectId !== undefined &&
        request.body.projectId !== projectId
      )
        throw new RequestError(
          400,
          'Assign a project separately from resuming a session.',
        );
    } else if (
      request.body?.projectId !== undefined &&
      request.body.projectId !== null
    ) {
      projectId = positiveId(request.body.projectId, 'project');
      if (!findProject(projectId))
        throw new RequestError(404, 'Project not found.');
    }
  }
  const transport: unknown = request.body?.transport ?? 'chat';
  if (transport !== 'chat') {
    response.status(400).json({ error: 'Only chat sessions are supported.' });
    return;
  }
  const resumeSessionId: unknown = resumeId;
  const selectedAgentId: unknown = request.body?.agentId;
  let agent: Agent | undefined;
  if (selectedAgentId !== undefined) {
    if (resumeSessionId !== undefined) {
      response.status(400).json({
        error: 'A resumed session keeps its original agent configuration.',
      });
      return;
    }
    if (
      typeof selectedAgentId !== 'number' ||
      !Number.isSafeInteger(selectedAgentId) ||
      selectedAgentId <= 0
    ) {
      response.status(400).json({ error: 'Choose a valid agent.' });
      return;
    }
    agent = findAgent(selectedAgentId);
    if (!agent) {
      response
        .status(404)
        .json({ error: 'Agent not found. Choose another agent.' });
      return;
    }
  }
  let resume;
  if (resumeSessionId !== undefined) {
    if (
      typeof resumeSessionId !== 'string' ||
      !conversationIdPattern.test(resumeSessionId)
    ) {
      response.status(400).json({ error: 'Invalid session to resume.' });
      return;
    }
    resume = findSavedSession(projectId, resumeSessionId);
    if (!resume) {
      response
        .status(404)
        .json({ error: 'Session not found in this project.' });
      return;
    }
    if (resume.status !== 'exited' && resume.status !== 'interrupted') {
      response
        .status(409)
        .json({ error: 'This conversation is already open or queued.' });
      return;
    }
    if (
      !(resume.providerConversationId ?? resume.codexConversationId) ||
      !(
        resume.provider === 'opencode'
          ? /^ses[a-zA-Z0-9_-]+$/
          : conversationIdPattern
      ).test((resume.providerConversationId ?? resume.codexConversationId)!)
    ) {
      response.status(400).json({
        error: 'No provider conversation ID was captured for this session.',
      });
      return;
    }
  }

  const provider = resume?.provider ?? request.body?.provider ?? 'codex';
  if (
    provider !== 'codex' &&
    provider !== 'antigravity' &&
    provider !== 'opencode'
  ) {
    response
      .status(400)
      .json({ error: 'Choose Codex, Antigravity or OpenCode.' });
    return;
  }
  if (request.body?.provider && request.body.provider !== provider) {
    response.status(400).json({
      error: 'The saved session uses a different provider.',
    });
    return;
  }
  try {
    if (resume && request.body?.workingDirectory !== undefined)
      throw new RequestError(
        400,
        'A resumed session keeps its original working folder.',
      );
    const directory = resume
      ? resume.workingDirectory
      : await workingDirectory(request.body?.workingDirectory);
    if (resume) await requireWorkingDirectory(directory);
    const defaults =
      !resume && transport === 'chat' && request.body?.settings === undefined
        ? await newChatDefaults(provider, directory)
        : undefined;
    const settings =
      request.body?.settings !== undefined
        ? await validateChatSettings(request.body.settings, provider, directory)
        : defaults?.settings;
    if (resume && !findSessionById(resume.id))
      throw new RequestError(
        404,
        'This session was deleted while resuming it.',
      );
    if (projectId !== null && !findProject(projectId))
      throw new RequestError(
        409,
        'This project was deleted while starting the session. Choose another project or no project.',
      );
    const session = startSession(
      projectId,
      directory,
      resume,
      agent,
      transport,
      settings,
      provider,
    );
    if (session.chat) await session.chat.ready;
    response.status(201).json({
      session: withSessionActivity(session.info),
      ...(defaults?.notice ? { defaultsNotice: defaults.notice } : {}),
    });
  } catch (error) {
    if (error instanceof RequestError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Could not start provider:', error);
    response.status(503).json({
      error:
        'Could not start the provider. Check that its CLI is installed and signed in.',
    });
  }
}
