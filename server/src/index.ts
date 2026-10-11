import { initializeSkills } from './services/skills.js';
import app from './app.js';
import { shutdownSessions } from './services/sessions.js';
import { attachTerminal } from './lib/terminal/websocket.js';
import { startScheduler, stopScheduler } from './services/schedules.js';

initializeSkills();

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Server listening at http://127.0.0.1:${port}`);
});

const terminals = attachTerminal(server);
startScheduler();

function shutdown() {
  stopScheduler();
  for (const connection of terminals.clients) connection.terminate();
  terminals.close();
  server.close();
  void shutdownSessions()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error('Could not stop sessions:', error);
      process.exit(1);
    });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
