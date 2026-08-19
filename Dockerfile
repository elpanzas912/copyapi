FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# /data para jobs y uploads (montar volumen)
RUN mkdir -p /data/uploads /data/jobs
VOLUME /data

ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
