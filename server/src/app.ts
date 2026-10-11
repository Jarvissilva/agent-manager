import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { isAllowedOrigin } from './lib/security/requestOrigin.js';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import router from './router.js';
import { RequestError } from './lib/http/errors.js';

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use('/api', (request, response, next) => {
  if (request.headers.origin && !isAllowedOrigin(request)) {
    response.status(403).json({
      error: 'This request must come from a trusted dashboard origin.',
    });
    return;
  }
  next();
});
app.use('/api', router);
app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found.' });
});

// Resolve from src/ or dist/, independently of the process working directory.
const clientDirectory = resolve(import.meta.dirname, '../../client/dist');
const indexFile = resolve(clientDirectory, 'index.html');
if (existsSync(indexFile)) {
  app.use(express.static(clientDirectory, { index: false }));
  app.get('/{*path}', (request, response, next) => {
    if (
      request.path.startsWith('/assets/') ||
      extname(request.path) ||
      !request.accepts('html')
    ) {
      next();
      return;
    }
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(indexFile);
  });
}

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof RequestError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'Invalid JSON request.' });
      return;
    }

    console.error(error);
    response
      .status(500)
      .json({ error: 'Something went wrong. Please try again.' });
  },
);

export default app;
