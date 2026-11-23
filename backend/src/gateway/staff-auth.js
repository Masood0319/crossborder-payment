import jwt from 'jsonwebtoken';

const STAFF_ROLES = new Set([
  'KYC_REVIEWER',
  'KYC_ADMIN',
  'TREASURY_VIEWER',
  'TREASURY_OPERATOR',
  'TREASURY_ADMIN',
]);

export class StaffAuthenticationUnavailableError extends Error {}

export function verifyStaffSession(token, environment = process.env) {
  const publicKey = environment.STAFF_JWT_PUBLIC_KEY?.replace(/\\n/g, '\n');
  const issuer = environment.STAFF_JWT_ISSUER;
  const audience = environment.STAFF_JWT_AUDIENCE;
  if (!publicKey || !issuer || !audience) {
    throw new StaffAuthenticationUnavailableError('Staff identity provider is not configured');
  }

  const claims = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer,
    audience,
  });
  if (!claims || typeof claims !== 'object'
    || typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 255
    || typeof claims.iss !== 'string'
    || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)
    || !Array.isArray(claims.roles)
    || claims.roles.some(role => typeof role !== 'string' || !STAFF_ROLES.has(role))) {
    throw new Error('Staff token claims are invalid');
  }

  return {
    reviewerId: claims.sub,
    issuer: claims.iss,
    roles: [...new Set(claims.roles)],
  };
}

export function makeStaffAuthMiddleware(requiredRoles, verifier = verifyStaffSession, options = {}) {
  if (!Array.isArray(requiredRoles) || requiredRoles.length === 0) {
    throw new Error('At least one required staff role must be specified');
  }
  return async (req, res, next) => {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) {
      if (options.auditDenied) await options.auditDenied(req, 'missing staff session');
      return res.status(401).json({ error: 'Authenticated staff session required' });
    }

    let identity;
    try {
      identity = verifier(token);
    } catch (error) {
      if (error instanceof StaffAuthenticationUnavailableError) {
        if (options.auditDenied) await options.auditDenied(req, 'staff authentication unavailable');
        return res.status(503).json({ error: 'Staff authentication is not configured' });
      }
      if (options.auditDenied) await options.auditDenied(req, 'invalid or expired staff session');
      return res.status(401).json({ error: 'Invalid or expired staff session' });
    }

    if (!identity || typeof identity.reviewerId !== 'string'
      || typeof identity.issuer !== 'string' || !Array.isArray(identity.roles)) {
      if (options.auditDenied) await options.auditDenied(req, 'invalid staff identity claims');
      return res.status(401).json({ error: 'Invalid staff identity claims' });
    }
    req.staffIdentity = identity;
    if (!requiredRoles.some(role => identity.roles.includes(role))) {
      if (options.auditDenied) await options.auditDenied(req, 'staff role is not authorized');
      return res.status(403).json({ error: 'Staff role is not authorized for this operation' });
    }
    return next();
  };
}
