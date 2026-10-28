import type { AuthUser } from "@hegemonia/shared";
import { api } from "./api";

class AuthStore {
  user = $state<AuthUser | null>(null);
  ready = $state(false);
  dialogOpen = $state(false);

  async init(): Promise<void> {
    try {
      const result = await api<{ user: AuthUser | null }>("/api/auth/me");
      this.user = result.user;
    } catch {
      this.user = null;
    } finally {
      this.ready = true;
    }
  }

  async logout(): Promise<void> {
    await api<void>("/api/auth/logout", { method: "POST" });
    this.user = null;
  }
}

export const auth = new AuthStore();
