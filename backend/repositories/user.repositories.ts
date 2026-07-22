import { supabaseAdmin } from "../config/supabase";
import type { User, PublicUser, UserRole } from "../types/auth.types";

const TABLE = "users";

/**
 * Strips the password_hash and sensitive fields from a user record.
 */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    is_verified: user.is_verified,
    created_at: user.created_at,
  };
}

/**
 * Find a user by their email address.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as User | null;
}

/**
 * Find a user by their ID.
 */
export async function findUserById(id: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as User | null;
}

/**
 * Find a user by their reset token.
 */
export async function findUserByResetToken(token: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("reset_token", token)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as User | null;
}

/**
 * Create a new user record.
 */
export async function createUser(payload: {
  name: string;
  email: string;
  password_hash: string;
  role?: UserRole;
}): Promise<User> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert([
      {
        name: payload.name,
        email: payload.email.toLowerCase().trim(),
        password_hash: payload.password_hash,
        role: payload.role ?? "user",
        is_verified: false,
        refresh_token: null,
        reset_token: null,
        reset_token_expires: null,
      },
    ])
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as User;
}

/**
 * Update a user's refresh token (store or clear it).
 */
export async function updateRefreshToken(
  userId: string,
  refreshToken: string | null
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ refresh_token: refreshToken, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

/**
 * Update a user's hashed password.
 */
export async function updatePassword(
  userId: string,
  passwordHash: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      password_hash: passwordHash,
      reset_token: null,
      reset_token_expires: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

/**
 * Set a password-reset token and expiry on the user record.
 */
export async function setResetToken(
  userId: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      reset_token: token,
      reset_token_expires: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

/**
 * Mark a user's email as verified.
 */
export async function verifyUserEmail(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ is_verified: true, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

/**
 * Update a user's profile fields (name / email).
 */
export async function updateUserProfile(
  userId: string,
  fields: { name?: string; email?: string }
): Promise<User> {
  const updates: Record<string, unknown> = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  if (fields.email) updates.email = fields.email.toLowerCase().trim();

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(updates)
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as User;
}

/**
 * Delete a user by ID.
 */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

/**
 * List all users (admin use).
 */
export async function listAllUsers(): Promise<PublicUser[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, name, email, role, is_verified, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as PublicUser[];
}
