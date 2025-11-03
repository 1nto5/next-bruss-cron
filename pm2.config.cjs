module.exports = {
  apps: [
    {
      name: 'bruss-cron',
      script: './index.js',
      interpreter: 'bun',
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
