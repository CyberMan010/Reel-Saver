import { randomUUID } from "crypto";
import { supabaseAdmin } from "../config/supabase";
import { mutateLocalDb, readLocalDb } from "../storage/localStore";
import { withStorageFallback } from "../storage/storageManager";
import type { User, PublicUser, UserRole } from "../types/auth.types";

const TABLE = "users";

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

export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = email.toLowerCase().trim();
  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("email", normalized)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data as User | null;
    },
    () => {
      const db = readLocalDb();
      return db.users.find((u) => u.email === normalized) ?? null;
    }
  );
}

export async function findUserById(id: string): Promise<User | null> {
  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data as User | null;
    },
    () => {
      const db = readLocalDb();
      return db.users.find((u) => u.id === id) ?? null;
    }
  );
}

export async function findUserByResetToken(token: string): Promise<User | null> {
  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("reset_token", token)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data as User | null;
    },
    () => {
      const db = readLocalDb();
      return db.users.find((u) => u.reset_token === token) ?? null;
    }
  );
}

export async function createUser(payload: {
  name: string;
  email: string;
  password_hash: string;
  role?: UserRole;
}): Promise<User> {
  const normalizedEmail = payload.email.toLowerCase().trim();

  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .insert([
          {
            name: payload.name.trim(),
            email: normalizedEmail,
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
    },
    () => {
      const now = new Date().toISOString();
      const newUser: User = {
        id: randomUUID(),
        name: payload.name.trim(),
        email: normalizedEmail,
        password_hash: payload.password_hash,
        role: payload.role ?? "user",
        is_verified: false,
        refresh_token: null,
        reset_token: null,
        reset_token_expires: null,
        created_at: now,
        updated_at: now,
      };
      return mutateLocalDb((db) => {
        db.users.push(newUser);
        return newUser;
      });
    }
  );
}

export async function updateRefreshToken(
  userId: string,
  refreshToken: string | null
): Promise<void> {
  await withStorageFallback(
    async () => {
      const { error } = await supabaseAdmin
        .from(TABLE)
        .update({
          refresh_token: refreshToken,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) throw new Error(error.message);
    },
    () => {
      mutateLocalDb((db) => {
        const user = db.users.find((u) => u.id === userId);
        if (user) {
          user.refresh_token = refreshToken;
          user.updated_at = new Date().toISOString();
        }
      });
    }
  );
}

export async function updatePassword(
  userId: string,
  passwordHash: string
): Promise<void> {
  await withStorageFallback(
    async () => {
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
    },
    () => {
      mutateLocalDb((db) => {
        const user = db.users.find((u) => u.id === userId);
        if (user) {
          user.password_hash = passwordHash;
          user.reset_token = null;
          user.reset_token_expires = null;
          user.updated_at = new Date().toISOString();
        }
      });
    }
  );
}

export async function setResetToken(
  userId: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  await withStorageFallback(
    async () => {
      const { error } = await supabaseAdmin
        .from(TABLE)
        .update({
          reset_token: token,
          reset_token_expires: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) throw new Error(error.message);
    },
    () => {
      mutateLocalDb((db) => {
        const user = db.users.find((u) => u.id === userId);
        if (user) {
          user.reset_token = token;
          user.reset_token_expires = expiresAt.toISOString();
          user.updated_at = new Date().toISOString();
        }
      });
    }
  );
}

export async function verifyUserEmail(userId: string): Promise<void> {
  await withStorageFallback(
    async () => {
      const { error } = await supabaseAdmin
        .from(TABLE)
        .update({ is_verified: true, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (error) throw new Error(error.message);
    },
    () => {
      mutateLocalDb((db) => {
        const user = db.users.find((u) => u.id === userId);
        if (user) {
          user.is_verified = true;
          user.updated_at = new Date().toISOString();
        }
      });
    }
  );
}

export async function updateUserProfile(
  userId: string,
  fields: { name?: string; email?: string }
): Promise<User> {
  return withStorageFallback(
    async () => {
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
    },
    () => {
      return mutateLocalDb((db) => {
        const user = db.users.find((u) => u.id === userId);
        if (!user) throw new Error("User not found.");
        if (fields.name !== undefined) user.name = fields.name.trim();
        if (fields.email !== undefined) {
          user.email = fields.email.toLowerCase().trim();
        }
        user.updated_at = new Date().toISOString();
        return { ...user };
      });
    }
  );
}

export async function deleteUser(userId: string): Promise<void> {
  await withStorageFallback(
    async () => {
      const { error } = await supabaseAdmin
        .from(TABLE)
        .delete()
        .eq("id", userId);

      if (error) throw new Error(error.message);
    },
    () => {
      mutateLocalDb((db) => {
        db.users = db.users.filter((u) => u.id !== userId);
        db.reels = db.reels.filter((r) => r.userId !== userId);
        db.categories = db.categories.filter((c) => c.userId !== userId);
      });
    }
  );
}

export async function listAllUsers(): Promise<PublicUser[]> {
  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("id, name, email, role, is_verified, created_at")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data ?? []) as PublicUser[];
    },
    () => {
      const db = readLocalDb();
      return [...db.users]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(toPublicUser);
    }
  );
}
