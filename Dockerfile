FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache git
RUN mkdir -p /tmp/original && cd /tmp/original \
  && git init \
  && git remote add origin https://github.com/kwd421/agentsassemble-rust.git \
  && git fetch --depth 1 origin 2135d5112d00f80996a5f6ce98762515049cfcb8 \
  && git checkout --detach FETCH_HEAD
COPY package.json ./
RUN npm install
COPY . .
RUN rm -rf src/styles/original src/assets \
  && mkdir -p src/styles public \
  && cp -R /tmp/original/frontend/src/styles/original src/styles/original \
  && if [ -d /tmp/original/frontend/src/assets ]; then cp -R /tmp/original/frontend/src/assets src/assets; fi \
  && if [ -d /tmp/original/frontend/public ]; then cp -R /tmp/original/frontend/public/. public/; fi
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "server.mjs"]
