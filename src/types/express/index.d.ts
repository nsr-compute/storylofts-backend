// src/types/express/index.d.ts - Must be created to fix type errors

declare namespace Express {
  export interface Request {
    user?: {
      sub: string;
      email?: string;
      name?: string;
      [key: string]: any;
    };
    requestId?: string;
    rawBody?: Buffer;
  }
}