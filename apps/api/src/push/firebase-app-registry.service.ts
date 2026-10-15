import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
// Root import, not the 'firebase-admin/app' subpath: this repo's tsconfig uses classic
// "node" module resolution, which doesn't understand firebase-admin's package.json
// `exports` map (subpaths resolve fine at runtime via Node itself, but not for TS
// typechecking). The root package re-exports this exact set, so it type-checks correctly.
import { App, cert, deleteApp, initializeApp } from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { PushConfigService } from './push-config.service';
import { parseServiceAccountJson } from './service-account.util';

interface CacheEntry {
  app: App;
  configUpdatedAtMs: number;
}

/** Lazily builds and caches one firebase-admin App per tenant, keyed off the tenant's own
 *  Firebase service account (per-tenant Firebase projects — see TenantPushConfig). Self-heals
 *  on credential rotation: instead of a separate invalidation call from PushConfigService
 *  (which would make the two services depend on each other), every getApp() compares the
 *  cached entry's config `updatedAt` against the current DB row and rebuilds if it changed. */
@Injectable()
export class FirebaseAppRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(FirebaseAppRegistryService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushConfig: PushConfigService,
  ) {}

  /** Returns null (not a throw) when the tenant hasn't configured Firebase yet — the caller
   *  (PushSenderService) treats "no app" as "push silently does nothing for this tenant",
   *  which is the right behavior for tenants that haven't opted into push at all. */
  async getApp(tenantId: string): Promise<App | null> {
    const config = await this.prisma.tenantPushConfig.findUnique({ where: { tenantId } });
    if (!config) return null;

    const updatedAtMs = config.updatedAt.getTime();
    const cached = this.cache.get(tenantId);
    if (cached && cached.configUpdatedAtMs === updatedAtMs) return cached.app;

    if (cached) {
      await deleteApp(cached.app).catch(() => undefined);
      this.cache.delete(tenantId);
    }

    const raw = parseServiceAccountJson(this.pushConfig.decrypt(config.encryptedServiceAccount));
    const app = initializeApp(
      {
        credential: cert({
          projectId: raw.project_id,
          clientEmail: raw.client_email,
          privateKey: raw.private_key,
        }),
      },
      // Unique per credential version — initializeApp throws "app already exists" if the same
      // name is reused, so the version timestamp doubles as a safe way to rotate without
      // colliding with the entry it's replacing.
      `tenant-${tenantId}-${updatedAtMs}`,
    );
    this.cache.set(tenantId, { app, configUpdatedAtMs: updatedAtMs });
    return app;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      Array.from(this.cache.values()).map((entry) =>
        deleteApp(entry.app).catch((err) => this.logger.warn(`Failed to clean up Firebase app: ${(err as Error).message}`)),
      ),
    );
  }
}
