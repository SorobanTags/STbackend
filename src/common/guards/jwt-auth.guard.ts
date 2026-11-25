import { Injectable, ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';

// shortcut: fixed window, not configurable; move to ConfigService if ops need to tune it
const SESSION_ACTIVITY_THROTTLE_MS = 60_000;

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    private readonly logger = new Logger(JwtAuthGuard.name);

    constructor(private readonly prisma: PrismaService) {
        super();
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // First, validate the JWT token
        const canActivate = await super.canActivate(context);
        if (!canActivate) {
            return false;
        }

        // Get the request object
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || !user.id) {
            throw new UnauthorizedException('Invalid token payload');
        }

        // Issue #69 — reject requests carrying a revoked/expired session token.
        // Tokens issued before session tracking existed carry no `jti` and are let through.
        if (user.jti) {
            const session = await this.prisma.session.findUnique({
                where: { jti: user.jti },
                select: { revokedAt: true, expiresAt: true, lastActiveAt: true },
            });

            if (session) {
                const now = new Date();
                if (session.revokedAt) {
                    throw new UnauthorizedException('Session has been revoked');
                }
                if (session.expiresAt <= now) {
                    throw new UnauthorizedException('Session has expired');
                }

                // Throttled: at most one write per window per session, kept off the request path.
                if (now.getTime() - session.lastActiveAt.getTime() > SESSION_ACTIVITY_THROTTLE_MS) {
                    this.prisma.session
                        .update({ where: { jti: user.jti }, data: { lastActiveAt: now } })
                        .catch((error: unknown) =>
                            this.logger.warn(`Failed to update lastActiveAt for session ${user.jti}: ${String(error)}`),
                        );
                }
            }
        }

        return true;
    }
}
