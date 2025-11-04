module.exports = {
  apps: [
    {
      name: 'bruss-cron',
      script: './index.js',
      interpreter: 'bun',
      instances: 1,
      exec_mode: 'fork',
      error_file: 'C:\\ProgramData\\pm2\\home\\logs\\bruss-cron-error.log',
      out_file: 'C:\\ProgramData\\pm2\\home\\logs\\bruss-cron-out.log',
    },
  ],
};
