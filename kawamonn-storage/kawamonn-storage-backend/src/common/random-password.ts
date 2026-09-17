import * as crypto from 'crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';

/** Generates a temporary password using a CSPRNG (crypto.randomInt), not Math.random(). */
export function generateTempPassword(length = 12): string {
    let out = '';
    for (let i = 0; i < length; i++) {
        out += CHARSET.charAt(crypto.randomInt(CHARSET.length));
    }
    return out;
}
