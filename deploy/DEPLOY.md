# Deployment: therapyagent.athenabot.ai on EC2

Assumes:
- Node 20+
- Postgres running locally
- Nginx + Certbot installed
- PM2 installed

## 1. Copy app

```bash
sudo mkdir -p /opt/apps/therapyagent
sudo chown -R ubuntu:ubuntu /opt/apps/therapyagent
cd /opt/apps/therapyagent
```

Copy the contents of this package into `/opt/apps/therapyagent`.

## 2. Install

```bash
npm install
cp .env.example .env
nano .env
chmod 600 .env
```

Use port `3060` unless it conflicts.

## 3. Create database

```bash
sudo -u postgres psql
CREATE USER therapyagent WITH PASSWORD 'YOUR_REAL_PASSWORD';
CREATE DATABASE therapyagent OWNER therapyagent;
GRANT ALL PRIVILEGES ON DATABASE therapyagent TO therapyagent;
\q
```

Set:

```bash
DATABASE_URL=postgresql://therapyagent:YOUR_REAL_PASSWORD@127.0.0.1:5432/therapyagent
```

Then:

```bash
npm run migrate
```

## 4. Start

```bash
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 logs therapyagent --lines 80
```

## 5. Nginx and SSL

```bash
sudo cp deploy/nginx-therapyagent.conf /etc/nginx/sites-available/therapyagent.athenabot.ai
sudo ln -sf /etc/nginx/sites-available/therapyagent.athenabot.ai /etc/nginx/sites-enabled/therapyagent.athenabot.ai
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d therapyagent.athenabot.ai
```

## 6. Validate

```bash
curl -i http://127.0.0.1:3060/api/health
curl -i https://therapyagent.athenabot.ai/api/health
```
