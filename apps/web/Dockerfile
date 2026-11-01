FROM node:20-alpine AS build

WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json

RUN npm ci

COPY apps/web apps/web

RUN npm run build --workspace @verity/web

FROM nginx:1.27-alpine

# API upstream used by nginx (envsubst'd into default.conf by the nginx
# entrypoint at startup). Default matches docker-compose; Render overrides it
# to http://verity-api:4000 via the API_UPSTREAM env var.
ENV API_UPSTREAM=http://api:4000

COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
