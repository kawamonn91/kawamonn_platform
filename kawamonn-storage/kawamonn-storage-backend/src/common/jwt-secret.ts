/**
 * Single source of truth for the JWT signing secret. Every module that previously
 * hardcoded its own fallback (and one that used a different fallback value entirely)
 * now reads it from here, so a missing JWT_SECRET fails app startup immediately
 * instead of silently signing/verifying tokens with a guessable default.
 */
export function getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
        throw new Error(
            'JWT_SECRET environment variable must be set to a random string of at least 16 characters.',
        );
    }
    return secret;
}
