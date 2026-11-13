FROM node:24.22.1-bookworm-slim AS dev
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm ci --no-audit --no-fund
COPY apps/frontend ./apps/frontend
EXPOSE 5178
CMD ["npm", "run", "dev"]

FROM dev AS build
RUN npm run build

FROM nginx:1.28-alpine AS production
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
