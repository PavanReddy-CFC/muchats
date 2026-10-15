export interface FirebaseServiceAccountJson {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Validates + narrows the raw JSON an admin pastes in from the Firebase console (Project
 *  settings -> Service accounts -> Generate new private key). Parsed once at set-time (to
 *  extract project_id for display and to reject junk before it's ever encrypted) and again
 *  every time a cached FirebaseAppRegistryService entry expires. */
export function parseServiceAccountJson(raw: string): FirebaseServiceAccountJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('serviceAccountJson must be valid JSON');
  }
  const obj = parsed as Partial<FirebaseServiceAccountJson>;
  if (!obj.project_id || !obj.client_email || !obj.private_key) {
    throw new Error(
      'serviceAccountJson is missing project_id, client_email, or private_key — paste the full ' +
        'Firebase service-account JSON exactly as downloaded',
    );
  }
  return obj as FirebaseServiceAccountJson;
}
