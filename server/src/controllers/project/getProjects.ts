import type { Request, Response } from 'express';
import { projectDependencies } from '../../repositories/projects.js';
import { database } from '../../lib/database.js';
export default function getProjects(_request: Request, response: Response) {
  const paths =
    database.prepare(`SELECT workingDirectory FROM sessions WHERE projectId=?
    UNION SELECT workingDirectory FROM schedule_steps WHERE scheduleId IN (SELECT id FROM schedules WHERE projectId=?)
    ORDER BY workingDirectory`);
  response.json(
    database
      .prepare('SELECT id,name FROM projects ORDER BY id')
      .all()
      .map((project) => ({
        ...project,
        ...projectDependencies(Number(project.id)),
        paths: paths
          .all(project.id, project.id)
          .map((row) => String(row.workingDirectory))
          .filter(Boolean),
      })),
  );
}
