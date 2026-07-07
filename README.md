# TherapyAgent

TherapyAgent is a starter full-stack application for a voice-first, AI-assisted therapy documentation workspace for ABA / I-DD service organizations.

It supports:
- Multi-tenant organizations
- First-user-as-admin registration
- Role-based access control
- MFA setup and enforcement before patient-record access
- Patient registry
- Session/activity logs
- Behavior event / ABC logging
- Therapy plans
- AI draft report generation with a PHI safety gate
- Audit logging

## Compliance warning

This starter is not, by itself, a HIPAA-compliant production system. It is a build foundation. Before using real PHI:
- execute BAAs / Healthcare Addenda with all vendors that create, receive, maintain, or transmit PHI
- enforce MFA before access to PHI
- use TLS, encrypted storage, encrypted backups, and strict database grants
- complete a HIPAA risk analysis
- implement audit review, incident response, breach notification, retention, and termination procedures
- disable external AI PHI processing unless explicitly approved and contracted

## Install

```bash
cd /opt/apps
git clone <your-new-repo> therapyagent
cd therapyagent
npm install
cp .env.example .env
nano .env
```

## Database

```bash
sudo -u postgres psql
CREATE USER therapyagent WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE therapyagent OWNER therapyagent;
GRANT ALL PRIVILEGES ON DATABASE therapyagent TO therapyagent;
\q
```

Set `DATABASE_URL` in `.env`, then:

```bash
npm run migrate
```

## Run

```bash
npm start
```

Health check:

```bash
curl -i http://127.0.0.1:3060/api/health
```

## PM2

```bash
pm2 start deploy/ecosystem.config.js
pm2 save
```

## Nginx

```bash
sudo cp deploy/nginx-therapyagent.conf /etc/nginx/sites-available/therapyagent.athenabot.ai
sudo ln -sf /etc/nginx/sites-available/therapyagent.athenabot.ai /etc/nginx/sites-enabled/therapyagent.athenabot.ai
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d therapyagent.athenabot.ai
```
