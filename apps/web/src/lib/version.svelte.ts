import { HEGEMONIA_VERSION } from "@hegemonia/shared";
import { API_BASE } from "./api.js";

declare const __COMMIT_HASH__: string | undefined;

export const CLIENT_COMMIT_HASH: string =
  typeof __COMMIT_HASH__ !== "undefined" && __COMMIT_HASH__ ? __COMMIT_HASH__ : "dev";

const RELOAD_ATTEMPT_PREFIX = "hegemonia_auto_reload_attempt_";

export class VersionGuardState {
  readonly clientVersion: string = HEGEMONIA_VERSION;
  readonly clientCommitHash: string = CLIENT_COMMIT_HASH;
  serverVersion = $state<string | null>(null);
  serverCommitHash = $state<string | null>(null);
  isOutdated = $state<boolean>(false);
  dismissed = $state<boolean>(false);
  countdown = $state<number | null>(null);
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  checkServerVersion(incomingVersion: string | null | undefined, inActiveBattle: boolean) {
    if (!incomingVersion) return;
    if (incomingVersion !== this.clientVersion) {
      this.serverVersion = incomingVersion;
      this.isOutdated = true;

      // Inicia auto-reload suave somente se não estiver em batalha ativa
      if (!inActiveBattle && this.countdown === null && !this.dismissed) {
        this.scheduleAutoReload(incomingVersion);
      }
    }
  }

  private scheduleAutoReload(version: string) {
    try {
      const alreadyAttempted = sessionStorage.getItem(`${RELOAD_ATTEMPT_PREFIX}${version}`);
      if (alreadyAttempted) {
        // Já tentou recarregar automaticamente para esta versão nesta sessão, não entrar em loop
        return;
      }
    } catch {
      // Ignora erro em ambientes sem sessionStorage
    }

    this.countdown = 5;
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    this.countdownTimer = setInterval(() => {
      if (this.countdown === null || this.countdown <= 1) {
        this.clearTimer();
        this.reload();
      } else {
        this.countdown -= 1;
      }
    }, 1000);
  }

  cancelCountdown() {
    this.clearTimer();
    this.countdown = null;
  }

  private clearTimer() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  async checkViaApi(inActiveBattle = false) {
    try {
      const endpoint = `${API_BASE}/api/version`;
      const res = await fetch(endpoint, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      if (res.ok) {
        const data = (await res.json()) as { version?: string; commitHash?: string };
        if (data.commitHash) {
          this.serverCommitHash = data.commitHash;
        }
        if (data.version) {
          this.checkServerVersion(data.version, inActiveBattle);
        }
      }
    } catch {
      // Ignora erro se offline ou inicializando
    }
  }

  dismiss() {
    this.cancelCountdown();
    this.dismissed = true;
  }

  reload() {
    this.clearTimer();
    if (this.serverVersion) {
      try {
        sessionStorage.setItem(`${RELOAD_ATTEMPT_PREFIX}${this.serverVersion}`, "true");
      } catch {
        // Storage restrito
      }
    }
    window.location.reload();
  }
}

export const versionGuard = new VersionGuardState();
