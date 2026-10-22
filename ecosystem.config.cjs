const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'agent-manager',
      cwd: path.join(__dirname, 'server'),
      script: 'dist/index.js',
      node_args: '--env-file-if-exists=../.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: '6001',
      },
    },
  ],
};
