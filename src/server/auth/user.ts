import type { User } from "@prisma/client";

export function toPublicUser(user: Pick<User, "id" | "email" | "name" | "profileImage" | "role" | "createdAt">) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    profileImage: user.profileImage,
    role: user.role,
    createdAt: user.createdAt,
  };
}