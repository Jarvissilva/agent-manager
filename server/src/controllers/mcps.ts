import type { Request, Response } from 'express';
import { positiveId } from '../lib/http/errors.js';
import {
  addMcp,
  deleteMcp,
  getMcp,
  getMcps,
  importMcps,
  syncMcp,
  updateMcp,
} from '../services/mcps.js';
export function list(request: Request, response: Response) {
  void request;
  response.json(getMcps());
}
export function get(request: Request, response: Response) {
  response.json(getMcp(positiveId(request.params.mcpId, 'MCP')));
}
export function create(request: Request, response: Response) {
  response.status(201).json(addMcp(request.body));
}
export function importConfig(request: Request, response: Response) {
  response.status(201).json(importMcps(request.body));
}
export function update(request: Request, response: Response) {
  response.json(
    updateMcp(positiveId(request.params.mcpId, 'MCP'), request.body),
  );
}
export function sync(request: Request, response: Response) {
  response.json(syncMcp(positiveId(request.params.mcpId, 'MCP')));
}
export function remove(request: Request, response: Response) {
  deleteMcp(positiveId(request.params.mcpId, 'MCP'));
  response.status(204).end();
}
