FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4177

COPY package.json ./
COPY src ./src
COPY public ./public
COPY config ./config
COPY .env.example ./.env.example
COPY README.md ./README.md

EXPOSE 4177

CMD ["node", "src/server.js"]
