import * as argon2 from 'argon2';
import { PrismaClient, TenantRole, ChannelType, ChannelMemberRole } from '../../generated/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await argon2.hash('password123');

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { slug: 'demo', name: 'Demo Workspace' },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.test' },
    update: {},
    create: { email: 'owner@demo.test', passwordHash, displayName: 'Demo Owner' },
  });

  const member = await prisma.user.upsert({
    where: { email: 'member@demo.test' },
    update: {},
    create: { email: 'member@demo.test', passwordHash, displayName: 'Demo Member' },
  });

  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
    update: {},
    create: { tenantId: tenant.id, userId: owner.id, role: TenantRole.OWNER },
  });

  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: member.id } },
    update: {},
    create: { tenantId: tenant.id, userId: member.id, role: TenantRole.MEMBER },
  });

  const channel = await prisma.channel.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: tenant.id,
      type: ChannelType.PUBLIC,
      name: 'general',
      members: {
        create: [
          { tenantId: tenant.id, userId: owner.id, role: ChannelMemberRole.OWNER },
          { tenantId: tenant.id, userId: member.id, role: ChannelMemberRole.MEMBER },
        ],
      },
    },
  });

  console.log('Seeded tenant:', tenant.slug);
  console.log('  owner@demo.test / password123');
  console.log('  member@demo.test / password123');
  console.log('  #general channel:', channel.id);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
