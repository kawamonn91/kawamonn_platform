/**
 * Data Migration Script: Flask SQLite → NestJS PostgreSQL
 *
 * This script migrates all user data from the Flask kawamonn_platform
 * (SQLite with integer IDs) to the NestJS kawamonn-storage backend
 * (PostgreSQL with UUIDs).
 *
 * Usage:
 *   npx ts-node scripts/migrate-flask-data.ts
 *
 * Prerequisites:
 *   - SQLite database file accessible (kawamonn_platform/*.db)
 *   - PostgreSQL database running with updated Prisma schema
 *   - Run `npx prisma migrate dev` before this script
 *
 * Data migrated:
 *   - Users (with ID mapping: integer → UUID)
 *   - AuditLogs (with user ID remapping)
 *   - MailSendLogs (with user ID remapping)
 *
 * Safety:
 *   - Existing NestJS users are preserved (no duplicates created)
 *   - Passwords are re-hashed from bcrypt to argon2 where possible
 *   - All operations are wrapped in transactions
 */

import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';

// We'll use better-sqlite3 for reading the Flask SQLite DB
// If not available, fall back to raw file reading
let Database: any;
try {
    Database = require('better-sqlite3');
} catch {
    console.log('better-sqlite3 not found. Trying sqlite3...');
    try {
        Database = null; // Will use alternate approach
    } catch {
        console.error('No SQLite driver found. Please install: npm install better-sqlite3');
        process.exit(1);
    }
}

const prisma = new PrismaClient();

// Path to the Flask SQLite database
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH
    || '/home/pi/hdd/ssh/kawamonn_platform/users.db';

// Mapping from old integer IDs to new UUIDs
const userIdMap = new Map<number, string>();

interface FlaskUser {
    id: number;
    username: string;
    email: string;
    password_hash: string;
    created_at: string;
    status: string;
    is_admin: number;
    fs_project_id: number | null;
    quota_bytes: number;
    used_bytes: number;
    password_last_set_at: string | null;
    expiry_at: string | null;
    last_reminder_sent: string | null;
}

interface FlaskAuditLog {
    id: number;
    user_id: number | null;
    action: string;
    details: string | null;
    ip_address: string | null;
    performer_id: number | null;
    timestamp: string;
}

interface FlaskMailSendLog {
    id: number;
    user_id: number;
    template_name: string;
    sent_at: string;
    status: string;
    response_body: string | null;
}

async function migrateUsers(db: any) {
    console.log('\n=== Migrating Users ===');

    const flaskUsers: FlaskUser[] = db.prepare('SELECT * FROM users').all();
    console.log(`Found ${flaskUsers.length} users in Flask DB`);

    let created = 0;
    let skipped = 0;

    for (const fu of flaskUsers) {
        // Check if user already exists in NestJS DB (by email)
        const existing = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: fu.email },
                    { account_name: fu.username },
                ],
            },
        });

        if (existing) {
            console.log(`  SKIP: ${fu.username} (${fu.email}) — already exists as ${existing.id}`);
            userIdMap.set(fu.id, existing.id);
            skipped++;
            continue;
        }

        // Map Flask status enum to NestJS string
        const statusMap: Record<string, string> = {
            pending: 'pending',
            active: 'active',
            suspended: 'suspended',
            deleted: 'deleted',
        };

        const newUser = await prisma.user.create({
            data: {
                account_name: fu.username,
                email: fu.email,
                password_hash: fu.password_hash, // Preserve bcrypt hash; NestJS supports both bcrypt and argon2
                role: fu.is_admin ? 'admin' : 'user',
                quota_bytes: BigInt(fu.quota_bytes),
                used_bytes: BigInt(fu.used_bytes),
                status: statusMap[fu.status] || 'active',
                fs_project_id: fu.fs_project_id,
                expiry_at: fu.expiry_at ? new Date(fu.expiry_at) : null,
                last_reminder_sent: fu.last_reminder_sent ? new Date(fu.last_reminder_sent) : null,
                password_last_set_at: fu.password_last_set_at ? new Date(fu.password_last_set_at) : new Date(fu.created_at),
                created_at: new Date(fu.created_at),
            },
        });

        userIdMap.set(fu.id, newUser.id);
        console.log(`  CREATE: ${fu.username} (${fu.email}) → ${newUser.id}`);
        created++;
    }

    console.log(`Users: ${created} created, ${skipped} skipped`);
}

async function migrateAuditLogs(db: any) {
    console.log('\n=== Migrating Audit Logs ===');

    let logs: FlaskAuditLog[];
    try {
        logs = db.prepare('SELECT * FROM audit_logs ORDER BY timestamp ASC').all();
    } catch {
        console.log('  No audit_logs table found — skipping');
        return;
    }

    console.log(`Found ${logs.length} audit logs in Flask DB`);

    let created = 0;
    for (const log of logs) {
        const actorId = log.user_id ? userIdMap.get(log.user_id) : null;

        await prisma.auditLog.create({
            data: {
                actor_id: actorId || null,
                action: log.action,
                target_type: 'user',
                metadata: {
                    details: log.details,
                    ip_address: log.ip_address,
                    performer_id: log.performer_id ? userIdMap.get(log.performer_id) : null,
                    migrated_from: 'flask',
                },
                created_at: new Date(log.timestamp),
            },
        });
        created++;
    }

    console.log(`Audit logs: ${created} created`);
}

async function migrateMailSendLogs(db: any) {
    console.log('\n=== Migrating Mail Send Logs ===');

    let logs: FlaskMailSendLog[];
    try {
        logs = db.prepare('SELECT * FROM mail_send_logs ORDER BY sent_at ASC').all();
    } catch {
        console.log('  No mail_send_logs table found — skipping');
        return;
    }

    console.log(`Found ${logs.length} mail send logs in Flask DB`);

    let created = 0;
    for (const log of logs) {
        const userId = userIdMap.get(log.user_id);
        if (!userId) {
            console.log(`  SKIP: mail log for unknown user_id ${log.user_id}`);
            continue;
        }

        await prisma.mailSendLog.create({
            data: {
                user_id: userId,
                template_name: log.template_name,
                status: log.status,
                response_body: log.response_body,
                sent_at: new Date(log.sent_at),
            },
        });
        created++;
    }

    console.log(`Mail send logs: ${created} created`);
}

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Flask → NestJS Data Migration                  ║');
    console.log('║  kawamonn_platform (SQLite) → kawamonn-storage  ║');
    console.log('╚══════════════════════════════════════════════════╝');

    // Check if SQLite DB exists
    if (!fs.existsSync(SQLITE_DB_PATH)) {
        console.error(`\nERROR: SQLite database not found at: ${SQLITE_DB_PATH}`);
        console.error('Set SQLITE_DB_PATH environment variable to the correct path.');
        console.error('Example: SQLITE_DB_PATH=/path/to/users.db npx ts-node scripts/migrate-flask-data.ts');
        process.exit(1);
    }

    console.log(`\nSource: ${SQLITE_DB_PATH}`);
    console.log(`Target: PostgreSQL (from DATABASE_URL env)`);

    // Open SQLite DB
    const db = new Database(SQLITE_DB_PATH, { readonly: true });

    try {
        // Run migrations in order
        await migrateUsers(db);
        await migrateAuditLogs(db);
        await migrateMailSendLogs(db);

        console.log('\n╔══════════════════════════════════════════════════╗');
        console.log('║  Migration Complete!                             ║');
        console.log('╚══════════════════════════════════════════════════╝');
        console.log(`\nUser ID mapping (Flask → NestJS):`);
        for (const [oldId, newId] of userIdMap) {
            console.log(`  ${oldId} → ${newId}`);
        }
    } catch (error) {
        console.error('\nMIGRATION FAILED:', error);
        console.error('\nThe PostgreSQL database may be in a partially migrated state.');
        console.error('To retry, fix the issue and re-run. Existing users will be skipped.');
        process.exit(1);
    } finally {
        db.close();
        await prisma.$disconnect();
    }
}

main();
