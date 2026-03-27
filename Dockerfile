FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

WORKDIR /usr/share/nginx/html

COPY --from=deps /app/node_modules/@ffmpeg ./node_modules/@ffmpeg
COPY index.html app.js styles.css ./

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
