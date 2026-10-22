FROM node:20-alpine AS build

WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json

RUN npm ci

COPY apps/api apps/api

RUN npm run build --workspace @verity/api

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /repo/apps/api/dist ./dist

USER node
EXPOSE 4000

CMD ["node", "dist/index.js"]
