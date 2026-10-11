import type { Request, Response } from 'express';
import {
  createSchedule,
  deleteSchedule,
  findSchedule,
  listSchedules,
  updateSchedule,
} from '../../repositories/schedules.js';
import { positiveId, RequestError } from '../../lib/http/errors.js';
import { validateSchedule } from './validation.js';
export function getSchedules(request: Request, response: Response) {
  response.json(
    listSchedules(
      request.query.projectId !== undefined
        ? positiveId(request.query.projectId, 'project')
        : undefined,
    ),
  );
}
export function getSchedule(request: Request, response: Response) {
  const value = findSchedule(positiveId(request.params.scheduleId, 'schedule'));
  if (!value) throw new RequestError(404, 'Schedule not found.');
  response.json(value);
}
export async function postSchedule(request: Request, response: Response) {
  const value = await validateSchedule(request.body);
  response.status(201).json(createSchedule(value.input, value.nextRunAt));
}
export async function putSchedule(request: Request, response: Response) {
  const id = positiveId(request.params.scheduleId, 'schedule');
  const old = findSchedule(id);
  if (!old) throw new RequestError(404, 'Schedule not found.');
  const value = await validateSchedule(request.body, old);
  response.json(
    updateSchedule(id, value.input, value.nextRunAt, value.completed),
  );
}
export function removeSchedule(request: Request, response: Response) {
  const id = positiveId(request.params.scheduleId, 'schedule');
  if (!findSchedule(id)) throw new RequestError(404, 'Schedule not found.');
  deleteSchedule(id);
  response.status(204).end();
}
export async function previewSchedule(request: Request, response: Response) {
  response.json({ dates: (await validateSchedule(request.body)).dates });
}
