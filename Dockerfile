# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# Baked into the bundle as __APP_VERSION__ (shown in the sidebar footer). CI passes the git tag on
# prod/stage builds and the short SHA on dev; empty default falls back to "<pkg>-dev" in vite.config.
ARG BUILD_VERSION=
ENV BUILD_VERSION=$BUILD_VERSION
RUN npm run build

# Production stage
FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf

RUN cat <<EOF > /etc/nginx/conf.d/default.conf
    server {
        listen       80;
        server_name  localhost;
        root   /usr/share/nginx/html;
        index  index.html;

        location / {
            try_files \$uri \$uri/ /index.html;
        }
    }
EOF

COPY --from=builder /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
