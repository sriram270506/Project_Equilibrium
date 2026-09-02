/**
 * Auth context - user identity and role from request
 */
export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: "VIEWER" | "OPERATOR" | "APPROVER" | "ADMIN";
}

/**
 * Check if user has required role(s)
 */
export function hasRole(
  context: AuthContext,
  requiredRoles: string | string[]
): boolean {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  return roles.includes(context.role);
}

/**
 * Check if user can approve payments (APPROVER or ADMIN)
 */
export function canApprove(context: AuthContext): boolean {
  return hasRole(context, ["APPROVER", "ADMIN"]);
}

/**
 * Check if user can operate (OPERATOR, APPROVER, or ADMIN)
 */
export function canOperate(context: AuthContext): boolean {
  return hasRole(context, ["OPERATOR", "APPROVER", "ADMIN"]);
}

/**
 * Check if user can view (all roles)
 */
export function canView(_context: AuthContext): boolean {
  return true;
}
