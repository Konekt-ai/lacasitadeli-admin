module.exports = {
  apps: [
    {
      name: 'lacasita-api',
      cwd: './apps/api',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', PORT: 3002 },
    },
    {
      name: 'lacasita-web',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start -H 0.0.0.0 -p 3001',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production', PORT: 3001, API_URL: 'http://localhost:3002' },
    },
  ],
};
