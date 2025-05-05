FROM oven/bun:1.2.12

WORKDIR /app

COPY bun.lock package.json ./

RUN bun install

COPY . .

CMD ["bun", "main.ts"]
