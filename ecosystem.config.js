module.exports = {
  apps: [
    {
      name: 'lacasita-api',
      cwd: './apps/api',
      script: 'src/index.js',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
    {
      name: 'lacasita-web',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        API_URL: 'http://localhost:3002',
      },
    },
  ],
};
