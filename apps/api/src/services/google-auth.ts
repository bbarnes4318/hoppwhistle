/**
 * Google OAuth Token Verification Service
 *
 * Verifies Google ID tokens and extracts user information.
 * SECURITY: Only trusts email addresses marked as verified by Google.
 */
import { OAuth2Client, TokenPayload } from 'google-auth-library';

const GOOGLE_CLIENT_ID = '196207148120-2navmspp2renu5cnvr06679jvhm5h12h.apps.googleusercontent.com';

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  picture: string | null;
}

export interface GoogleAuthResult {
  success: true;
  user: GoogleUserInfo;
}

export interface GoogleAuthError {
  success: false;
  error: string;
  code: 'INVALID_TOKEN' | 'UNVERIFIED_EMAIL' | 'MISSING_EMAIL';
}

/**
 * Verify a Google ID token and extract user information.
 *
 * SECURITY CONSTRAINT: This function explicitly checks that email_verified === true.
 * Unverified email addresses are rejected to prevent account takeover attacks.
 */
export async function verifyGoogleToken(
  idToken: string
): Promise<GoogleAuthResult | GoogleAuthError> {
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload: TokenPayload | undefined = ticket.getPayload();

    if (!payload) {
      return {
        success: false,
        error: 'Invalid token payload',
        code: 'INVALID_TOKEN',
      };
    }

    // SECURITY: Explicitly check email_verified
    if (!payload.email) {
      return {
        success: false,
        error: 'Token does not contain email address',
        code: 'MISSING_EMAIL',
      };
    }

    if (payload.email_verified !== true) {
      return {
        success: false,
        error:
          'Email address is not verified by Google. Please verify your Google account email first.',
        code: 'UNVERIFIED_EMAIL',
      };
    }

    // Extract name parts
    const firstName = payload.given_name || null;
    const lastName = payload.family_name || null;

    return {
      success: true,
      user: {
        googleId: payload.sub, // Google's unique user ID
        email: payload.email,
        emailVerified: true,
        firstName,
        lastName,
        picture: payload.picture || null,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Token verification failed';
    return {
      success: false,
      error: errorMessage,
      code: 'INVALID_TOKEN',
    };
  }
}
