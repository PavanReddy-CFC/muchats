import * as argon2 from 'argon2';
import { PrismaClient, TenantRole } from '../../generated/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@qennect.com';
const DEFAULT_PASSWORD = 'Qennect1@3#';

// The 9 communities seeded for the Qennect app in seed-communities.ts.
const QENNECT_COMMUNITY_IDS = [
  'f05aa0f7-d32f-4990-86b4-93cbcdb7970d', // Prime Strikers Club
  'a979affa-6540-418a-ac61-293c6a851d1b', // Lions Club
  '2a00f251-069f-475e-887a-69c0aa0a9a31', // ACE Tennis Club
  'fc012a27-9597-471c-ad8f-0b7011a2c6b3', // Northern Chesapeake Cruising Club
  '670f4bbf-c5bb-4146-a953-114625a70626', // Racquet Club
  'bc76dfc6-455f-45eb-8039-799303808279', // Cms community
  'e2eb4270-f35a-4076-ab0d-38b057676189', // Salty Dawg
  'a40138a7-0b44-4f28-8602-82485b80550d', // Cloud First Group
  '7a2db21b-184c-4176-83d0-fe6b7ea5f75d', // The Georgetown Yacht Club
];

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(DEFAULT_PASSWORD);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash },
    create: { email: ADMIN_EMAIL, passwordHash, displayName: 'Qennect Admin' },
  });
  console.log(`✔ user ${admin.email} (${admin.id}) — password reset to default`);

  for (const tenantId of QENNECT_COMMUNITY_IDS) {
    const membership = await prisma.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId, userId: admin.id } },
      update: { role: TenantRole.OWNER },
      create: { tenantId, userId: admin.id, role: TenantRole.OWNER },
      include: { tenant: true },
    });
    console.log(`  ✔ OWNER of ${membership.tenant.name}`);
  }

  // Every other user already in one of these 9 communities also gets the default password —
  // "make all default password Qennect1@3# for all the users in the Qennect App".
  const otherMembers = await prisma.tenantMembership.findMany({
    where: { tenantId: { in: QENNECT_COMMUNITY_IDS }, userId: { not: admin.id } },
    include: { user: true },
    distinct: ['userId'],
  });
  for (const m of otherMembers) {
    await prisma.user.update({ where: { id: m.userId }, data: { passwordHash } });
    console.log(`  ✔ reset password for existing member ${m.user.email}`);
  }
  if (otherMembers.length === 0) {
    console.log('  (no other users are members of these communities yet)');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
