import { prisma, prismaDirect } from "./prisma.js";

export const TX_OPTIONS = {
  maxWait: 15000,
  timeout: 60000,
};

export function runTransaction(callback, options = TX_OPTIONS) {
  return prismaDirect.$transaction(callback, options);
}

export { prisma, prismaDirect };
