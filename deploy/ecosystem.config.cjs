module.exports = {
  apps: [
    {
      name: "therapyagent",
      script: "./server.js",
      cwd: "/opt/apps/therapy",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      },
      max_memory_restart: "300M",
      autorestart: true,
      watch: false,
      time: true
    }
  ]
};
