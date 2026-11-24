# One Dockerfile, one image per service:
#   docker build --build-arg SERVICE=backend   -t cap-backend:1   services
#   docker build --build-arg SERVICE=collector -t cap-collector:1 services
#   docker build --build-arg SERVICE=evaluator -t cap-evaluator:1 services
#   docker build --build-arg SERVICE=presenter -t cap-presenter:1 services
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY common ./common
COPY catalog ./catalog
COPY collector ./collector
COPY backend ./backend
COPY evaluator ./evaluator
COPY presenter ./presenter
ARG SERVICE
RUN test -f "${SERVICE}/index.js" && echo "import './${SERVICE}/index.js';" > main.mjs
ENV CAP_SERVICE=${SERVICE}
USER node
EXPOSE 8080
CMD ["node", "main.mjs"]
