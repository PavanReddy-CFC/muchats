import { PrismaClient } from '../../generated/client';

const prisma = new PrismaClient();

/** One-off seed for the specific community (tenant) ids/names supplied for the Qennect app.
 *  Idempotent: re-running upserts by id rather than creating duplicates. */
const COMMUNITIES: { id: string; name: string }[] = [
  { id: 'f05aa0f7-d32f-4990-86b4-93cbcdb7970d', name: 'Prime Strikers Club' },
  { id: 'a979affa-6540-418a-ac61-293c6a851d1b', name: 'Lions Club' },
  { id: '2a00f251-069f-475e-887a-69c0aa0a9a31', name: 'ACE Tennis Club' },
  { id: 'fc012a27-9597-471c-ad8f-0b7011a2c6b3', name: 'Northern Chesapeake Cruising Club' },
  { id: '670f4bbf-c5bb-4146-a953-114625a70626', name: 'Racquet Club' },
  { id: 'bc76dfc6-455f-45eb-8039-799303808279', name: 'Cms community' },
  { id: 'e2eb4270-f35a-4076-ab0d-38b057676189', name: 'Salty Dawg' },
  { id: 'a40138a7-0b44-4f28-8602-82485b80550d', name: 'Cloud First Group' },
  { id: '7a2db21b-184c-4176-83d0-fe6b7ea5f75d', name: 'The Georgetown Yacht Club' },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main(): Promise<void> {
  for (const community of COMMUNITIES) {
    const slug = slugify(community.name);
    const tenant = await prisma.tenant.upsert({
      where: { id: community.id },
      update: { name: community.name, slug },
      create: { id: community.id, name: community.name, slug },
    });
    console.log(`✔ ${tenant.name} (${tenant.id}) slug=${tenant.slug}`);
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
