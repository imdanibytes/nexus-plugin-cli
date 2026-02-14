"use strict";

module.exports = function dockerfile(config) {
  return `FROM node:20-alpine

WORKDIR /app

COPY src/ ./

EXPOSE ${config.port}

CMD ["node", "server.js"]
`;
};
