/**
 * Phase 11 — face verification provider abstraction.
 *
 * IMPORTANT: there is NO real biometric verification provider wired into this
 * project yet. The mock provider therefore NEVER reports VERIFIED — it only
 * creates a PENDING (manual review) case. A real provider can be integrated by
 * implementing this interface; `verified` may then only ever come from the
 * provider's validated server response, never from client input.
 *
 * An unconfigured provider is a 503 (ServiceUnavailableException subclass),
 * never a generic 500. VerificationService.getFaceProvider() already guards
 * this and falls back to "configured:false + manual review".
 */
import { ServiceUnavailableException } from '@nestjs/common';

export class FaceVerificationUnavailableError extends ServiceUnavailableException {
  constructor(message = 'Face verification is not configured') {
    super({ statusCode: 503, message, code: 'SERVICE_UNAVAILABLE' });
  }
}
export interface FaceVerificationCase {
  /** Provider case reference. NEVER raw biometric data. */
  reference: string;
  /** Whether the provider can return an automated decision synchronously. */
  decision: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export interface FaceVerificationProvider {
  readonly name: string;
  /**
   * True only when a real, validated biometric provider is wired in.
   * The mock/placeholder provider reports `false` so the Verification Center
   * can truthfully show "unavailable / pending manual review".
   */
  readonly configured: boolean;
  /** Starts a verification case for the user. Implementation defines what
   *  (if anything) is stored — raw biometrics must not be persisted here. */
  startCase(userId: string): Promise<FaceVerificationCase>;
}

/**
 * Development/placeholder provider: manual review, never auto-verifies.
 * There is NO real biometric verification wired into the project, so this
 * provider honestly reports `configured: false` and only ever yields PENDING.
 */
export class MockFaceVerificationProvider implements FaceVerificationProvider {
  readonly name = 'mock';
  readonly configured = false;

  async startCase(userId: string): Promise<FaceVerificationCase> {
    return {
      reference: `face-manual-${userId}-${Date.now()}`,
      decision: 'PENDING',
    };
  }
}

export function createFaceVerificationProvider(): FaceVerificationProvider {
  const configured = (process.env.FACE_VERIFICATION_PROVIDER ?? '').trim().toLowerCase();
  if (!configured || configured === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      throw new FaceVerificationUnavailableError('Face verification is not configured');
    }
    return new MockFaceVerificationProvider();
  }
  // Real providers (e.g. a KYC vendor) plug in here behind the same interface.
  // Until one is implemented, fall back to manual review — never auto-verify.
  throw new FaceVerificationUnavailableError(
    `Face verification provider "${configured}" is configured but no adapter is implemented yet. Face verification is not configured.`,
  );
}
