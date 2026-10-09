import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import router from './router.js';

const app = express();

app.use(express.json());
app.use('/api', router);

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
