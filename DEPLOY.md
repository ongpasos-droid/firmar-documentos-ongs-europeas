# Deployment Guide — Signature System

## 1. Upload to VPS

```bash
# From your local machine, upload the project
scp -r firmas-adhesion/ root@YOUR_VPS_IP:/var/www/

# Or use git
cd /var/www
git clone YOUR_REPO_URL firmas-adhesion
```

## 2. Install Node.js (if not installed)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v  # Should be >= 18
```

## 3. Install dependencies

```bash
cd /var/www/firmas-adhesion
npm install
```

## 4. Configure environment

```bash
cp .env.example .env
nano .env
```

Fill in:
- `SMTP_PASS` — Your Gmail App Password (see below)
- `ADMIN_PASSWORD` — Password for the admin panel
- `BASE_URL` — Your domain (e.g., https://firmas.yourdomain.com)

### Gmail App Password Setup:
1. Go to https://myaccount.google.com
2. Security > 2-Step Verification (enable if not enabled)
3. Search "App passwords" or go to https://myaccount.google.com/apppasswords
4. Create app password for "Mail"
5. Copy the 16-character password to SMTP_PASS in .env

## 5. Configure Nginx

```bash
nano /etc/nginx/sites-available/firmas
```

Paste this configuration:

```nginx
server {
    listen 80;
    server_name firmas.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 10M;
    }
}
```

Enable and test:

```bash
ln -s /etc/nginx/sites-available/firmas /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 6. SSL Certificate

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d firmas.yourdomain.com
```

## 7. Start with PM2

```bash
npm install -g pm2
cd /var/www/firmas-adhesion
pm2 start server.js --name firmas-adhesion
pm2 save
pm2 startup
```

## 8. Test

1. Open https://firmas.yourdomain.com on your phone
2. Select an association
3. Fill test data and sign
4. Check both emails arrive
5. Go to https://firmas.yourdomain.com/admin (user: admin, password: your ADMIN_PASSWORD)

## Useful PM2 Commands

```bash
pm2 status                    # Check if running
pm2 logs firmas-adhesion      # View logs
pm2 restart firmas-adhesion   # Restart
pm2 stop firmas-adhesion      # Stop
```

## Backup

```bash
# Backup database and PDFs
tar -czf backup_$(date +%Y%m%d).tar.gz database/ pdfs/
```
