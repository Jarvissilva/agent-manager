export class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function positiveId(value: unknown, label = 'ID') {
  const id = typeof value === 'string' ? Number(value) : value;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
    throw new RequestError(400, `Invalid ${label}.`);
  return id;
}
export function textField(value: unknown, label: string, maximum: number) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    value.includes('\0')
  )
    throw new RequestError(400, `Enter ${label} of 1–${maximum} characters.`);
  return value.trim();
}
export function bodyObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new RequestError(400, 'Enter a valid request body.');
  return body as Record<string, unknown>;
}
