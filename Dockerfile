# ==============================================================================
# ANATEC PORTFOLIO & ACADEMY — DOCKER MULTI-STAGE HIGH PERFORMANCE CONTAINER
# ==============================================================================
FROM nginx:alpine-slim

LABEL maintainer="Chamsoudine Anaroua <anarouachamsoudine010@gmail.com>"
LABEL app="Anatec Portfolio, HackerLab & Git Terminal Sandbox"
LABEL version="2.8-hardened"

# Sécurité & durcissement Nginx
RUN rm -rf /etc/nginx/conf.d/* /usr/share/nginx/html/*

# Copie de la configuration Nginx optimisée WebAssembly, Cache & Sécurité
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    # En-têtes de sécurité renforcés
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(self)" always;

    # Support WebAssembly & MIME types
    types {
        text/html                             html htm shtml;
        text/css                              css;
        text/xml                              xml;
        image/gif                             gif;
        image/jpeg                            jpeg jpg;
        application/javascript                js;
        application/wasm                      wasm;
        application/json                      json;
        image/svg+xml                         svg svgz;
        image/x-icon                          ico;
    }

    # Compression Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml application/wasm;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache statique pour SVG et assets
    location ~* \.(svg|png|jpg|jpeg|gif|ico|wasm)$ {
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }

    error_page 404 /index.html;
}
EOF

# Copie de tous les fichiers du site
COPY . /usr/share/nginx/html/

# Exposer le port HTTP standard
EXPOSE 80

# Démarrage
CMD ["nginx", "-g", "daemon off;"]
