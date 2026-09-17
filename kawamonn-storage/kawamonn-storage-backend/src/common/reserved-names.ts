/**
 * account_name values that must never be allocated to a user.
 *
 * The user/admin storage tree lives at /home/pi/hdd/ssh/{account_name} (admins) or
 * /home/pi/hdd/ssh/users/{account_name} (regular users) — siblings of this app's own
 * deployment directory (/home/pi/hdd/ssh/kawamonn-storage). If an account_name were ever
 * allowed to collide with a real directory under /home/pi/hdd/ssh, the file browser could
 * end up serving that directory (including this app's own source and .env) to that account.
 */
export const RESERVED_ACCOUNT_NAMES = new Set([
    'kawamonn-storage',
    'users',
    'archives',
    'admin',
    'administrator',
    'root',
    'ssh',
]);

export function isReservedAccountName(accountName: string): boolean {
    return RESERVED_ACCOUNT_NAMES.has(accountName.trim().toLowerCase());
}
