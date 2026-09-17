/**
 * Jest `globalSetup` for the e2e suite. Runs once, before any test file, in a
 * process whose env vars are inherited by the workers Jest spawns afterward.
 *
 * Loads .env.test (dotenv never overwrites an already-set process.env value,
 * so this can never be shadowed by the app's real .env), then — because the
 * e2e tests TRUNCATE tables between runs — refuses to proceed at all unless
 * DATABASE_URL unmistakably points at the throwaway test database and not at
 * production. Finally creates the uuid-ossp extension the schema's
 * uuid_generate_v4() defaults require, since `prisma db push` does not create
 * extensions on its own.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

module.exports = async function globalSetup() {
    dotenv.config({ path: path.join(__dirname, '..', '.env.test') });

    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl.includes('kawamonn_test') || !dbUrl.includes(':5433')) {
        throw new Error(
            'Refusing to run e2e tests: DATABASE_URL does not look like the throwaway test database ' +
            '(expected it to reference kawamonn_test on port 5433 — check .env.test and docker-compose.test.yml). ' +
            `Got: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`,
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    } finally {
        await prisma.$disconnect();
    }

    // Ensure the test MinIO bucket exists so files.e2e-spec.ts doesn't need a
    // manual `mc mb` step on every fresh environment (local or CI).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Minio = require('minio');
    const minioClient = new Minio.Client({
        endPoint: process.env.MINIO_ENDPOINT,
        port: Number(process.env.MINIO_PORT),
        useSSL: false,
        accessKey: process.env.MINIO_ACCESS_KEY,
        secretKey: process.env.MINIO_SECRET_KEY,
    });
    const bucket = process.env.MINIO_BUCKET as string;
    const exists = await minioClient.bucketExists(bucket).catch(() => false);
    if (!exists) {
        await minioClient.makeBucket(bucket);
    }
};
