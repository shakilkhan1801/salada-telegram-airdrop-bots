# Redirect HTTP to HTTPS
server {
  listen 80;
  listen [::]:80;
  server_name salada.fun app.salada.fun;
  return 301 https://$host$request_uri;
}

# Main domain - salada.fun (Redirect to app subdomain)
server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name salada.fun;

  ssl_certificate /etc/letsencrypt/live/salada.fun/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/salada.fun/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers on;

  # Redirect to app subdomain
  return 301 https://app.salada.fun$request_uri;
}

# App subdomain - app.salada.fun (Salada Home Frontend)
server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name app.salada.fun;

  ssl_certificate /etc/letsencrypt/live/salada.fun/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/salada.fun/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers on;

  root /var/www/salada-home;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  # Cache static assets
  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
