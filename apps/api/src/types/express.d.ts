import type { AuthenticatedUser } from '../common/types/authenticated-user';

declare module 'express-serve-static-core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Request {
    user?: AuthenticatedUser;
  }
}
