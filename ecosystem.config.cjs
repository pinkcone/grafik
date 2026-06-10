module.exports = {
  apps: [
    {
      name: 'grafik-api',
      cwd: './back',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
};
