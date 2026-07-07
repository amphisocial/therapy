module.exports = {
  apps: [
    {
      name: "therapyagent",
      script: "./server.js",
      cwd: "/opt/apps/therapyagent",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      out_file: "/home/ubuntu/.pm2/logs/therapyagent-out.log",
      error_file: "/home/ubuntu/.pm2/logs/therapyagent-error.log",
      time: true
    }
  ]
};
