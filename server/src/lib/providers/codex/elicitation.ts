import type { ChatRequest } from '../../../services/chat.js';
import { RequestError } from '../../http/errors.js';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
function choices(schema: Record<string, unknown>) {
  if (Array.isArray(schema.enum))
    return schema.enum.map((value, index) => ({
      value: text(value),
      label: Array.isArray(schema.enumNames)
        ? text(schema.enumNames[index]) || text(value)
        : text(value),
      description: '',
    }));
  const options = schema.oneOf ?? schema.anyOf;
  return Array.isArray(options)
    ? options.map((value) => ({
        value: text(object(value).const),
        label: text(object(value).title) || text(object(value).const),
        description: '',
      }))
    : [];
}
export function mcpElicitation(
  id: string | number,
  params: Record<string, unknown>,
): ChatRequest {
  const schema = object(params.requestedSchema);
  const properties = object(schema.properties);
  const required = Array.isArray(schema.required) ? schema.required : [];
  let mode: 'form' | 'url' | 'unsupported' = 'unsupported';
  if (
    ['form', 'openai/form', 'openaiForm'].includes(text(params.mode)) &&
    schema.type === 'object' &&
    required.every(
      (key) => typeof key === 'string' && Object.hasOwn(properties, key),
    ) &&
    Object.keys(properties).length <= 50 &&
    Object.values(properties).every(
      (value) =>
        ['string', 'boolean', 'number', 'integer', 'array'].includes(
          text(object(value).type),
        ) &&
        (object(value).type !== 'array' ||
          (object(object(value).items).type === 'string' &&
            choices(object(object(value).items)).length > 0)),
    )
  )
    mode = 'form';
  let url: string | undefined;
  if (params.mode === 'url') {
    try {
      const address = new URL(text(params.url));
      if (
        ['https:', 'http:'].includes(address.protocol) &&
        !address.username &&
        !address.password
      ) {
        url = address.href;
        mode = 'url';
      }
    } catch {
      /* Display an unsupported request instead of an unsafe link. */
    }
  }
  return {
    id,
    kind: 'mcp',
    title: `${text(params.serverName) || 'MCP server'} needs your consent`,
    detail: [
      text(params.message) || text(params.description),
      mode === 'unsupported'
        ? 'This request needs an interaction that is not supported here. Decline or cancel it; no approval will be sent automatically.'
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    elicitation: {
      mode,
      ...(mode === 'form' ? { schema } : {}),
      ...(url ? { url } : {}),
    },
    questions:
      mode === 'form'
        ? Object.entries(properties).map(([key, value]) => {
            const field = object(value);
            return {
              id: key,
              question: [text(field.title) || key, text(field.description)]
                .filter(Boolean)
                .join(' — '),
              secret: field.format === 'password',
              required: required.includes(key),
              inputType:
                field.type === 'array' ? 'multiselect' : text(field.type),
              options: choices(
                field.type === 'array' ? object(field.items) : field,
              ),
            };
          })
        : [],
  };
}

export function mcpElicitationResponse(
  request: ChatRequest,
  body: Record<string, unknown>,
) {
  const action = body.decision;
  if (!['accept', 'decline', 'cancel'].includes(text(action)))
    throw new RequestError(400, 'Choose approve, decline, or cancel.');
  if (action !== 'accept') return { action, content: null };
  if (request.elicitation?.mode === 'unsupported')
    throw new RequestError(
      400,
      'This MCP interaction cannot be approved here.',
    );
  if (request.elicitation?.mode === 'url') return { action, content: null };
  const schema = object(request.elicitation?.schema);
  const required = Array.isArray(schema.required) ? schema.required : [];
  const answers = object(body.answers);
  const content: [string, unknown][] = [];
  for (const [key, value] of Object.entries(object(schema.properties))) {
    const field = object(value);
    const answer = answers[key];
    const fail = () => {
      throw new RequestError(400, `Enter a valid answer for ${key}.`);
    };
    if (answer === undefined || answer === '') {
      if (required.includes(key)) fail();
      else continue;
    }
    if (typeof answer !== 'string' || answer.length > 10000) fail();
    let parsed: unknown = answer;
    if (field.type === 'boolean') {
      if (answer !== 'true' && answer !== 'false') fail();
      parsed = answer === 'true';
    } else if (field.type === 'number' || field.type === 'integer') {
      parsed = Number(answer);
      if (
        typeof answer !== 'string' ||
        !answer.trim() ||
        !Number.isFinite(parsed) ||
        (field.type === 'integer' && !Number.isInteger(parsed)) ||
        (typeof field.minimum === 'number' && Number(parsed) < field.minimum) ||
        (typeof field.maximum === 'number' && Number(parsed) > field.maximum)
      )
        fail();
    } else if (field.type === 'array') {
      try {
        parsed = JSON.parse(String(answer));
      } catch {
        fail();
      }
      if (
        !Array.isArray(parsed) ||
        parsed.some((item) => typeof item !== 'string') ||
        new Set(parsed).size !== parsed.length ||
        (typeof field.minItems === 'number' &&
          parsed.length < field.minItems) ||
        (typeof field.maxItems === 'number' && parsed.length > field.maxItems)
      )
        fail();
      const options = choices(object(field.items));
      if (
        options.length &&
        Array.isArray(parsed) &&
        parsed.some((item) => !options.some((option) => option.value === item))
      )
        fail();
    } else {
      const options = choices(field);
      if (options.length && !options.some((option) => option.value === answer))
        fail();
      if (
        typeof answer === 'string' &&
        ((typeof field.minLength === 'number' &&
          answer.length < field.minLength) ||
          (typeof field.maxLength === 'number' &&
            answer.length > field.maxLength))
      )
        fail();
    }
    content.push([key, parsed]);
  }
  return { action, content: Object.fromEntries(content) };
}

export function automaticMcpConfirmation(request: ChatRequest) {
  // An empty form is a confirmation, not a request for information. Never
  // invent form answers or claim that an external verification was completed.
  if (request.elicitation?.mode !== 'form' || request.questions.length) return;
  return mcpElicitationResponse(request, { decision: 'accept' });
}
