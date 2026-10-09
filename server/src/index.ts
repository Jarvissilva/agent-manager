import app from './app.js';

const port = 3001;

app.listen(port, '127.0.0.1', () => {
  console.log(`Server listening at http://127.0.0.1:${port}`);
});
