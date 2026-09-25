import { UserModel, type IUser } from "../models/user";

export interface EnsureUserProfileInput {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}

export const userRepository = {
  findById(id: string): Promise<IUser | null> {
    return UserModel.findById(id).exec();
  },
  findByEmail(email: string): Promise<IUser | null> {
    return UserModel.findOne({ email: email.trim().toLowerCase() }).exec();
  },
  async setSystemAdmin(id: string, isSystemAdmin: boolean): Promise<void> {
    await UserModel.findByIdAndUpdate(id, { $set: { isSystemAdmin } }).exec();
  },
  /**
   * Ported from the legacy plugin's lib/ensure-user-profile.ts. Auth.js's
   * MongoDB adapter creates a minimal `users` row on first OAuth sign-in;
   * this fills in tbook defaults without clobbering fields it doesn't own
   * (isSystemAdmin, role once already set).
   */
  async ensureUserProfile(input: EnsureUserProfileInput): Promise<string | null> {
    const email = input.email?.trim().toLowerCase();
    if (!email) return null;

    const existing = (input.id ? await UserModel.findById(input.id).exec() : null) ?? (await UserModel.findOne({ email }).exec());

    const profilePatch: Record<string, unknown> = { email };
    if (input.name?.trim()) profilePatch.name = input.name.trim();
    if (input.image?.trim()) profilePatch.image = input.image.trim();

    if (existing) {
      const set: Record<string, unknown> = { ...profilePatch };
      if (!existing.role) set.role = "USER";
      await UserModel.findByIdAndUpdate(existing._id, { $set: set }).exec();
      return String(existing._id);
    }

    const created = await UserModel.create({ ...profilePatch, role: "USER" });
    return String(created._id);
  },
};
