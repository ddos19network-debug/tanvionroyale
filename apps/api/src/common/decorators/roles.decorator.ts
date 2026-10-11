import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Restrict a route to users holding any of the given roles (RBAC). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
