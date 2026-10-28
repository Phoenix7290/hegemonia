<script lang="ts">
  import { auth } from "../lib/auth.svelte";
  import { api } from "../lib/api";
  import type { AuthUser } from "@hegemonia/shared";
  import Icon from "./Icon.svelte";

  let mode = $state<"login" | "register">("login");
  let identifier = $state("");
  let email = $state("");
  let username = $state("");
  let displayName = $state("");
  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;
    try {
      const result =
        mode === "login"
          ? await api<{ user: AuthUser }>("/api/auth/login", {
              method: "POST",
              body: JSON.stringify({ identifier, password }),
            })
          : await api<{ user: AuthUser }>("/api/auth/register", {
              method: "POST",
              body: JSON.stringify({ email, username, displayName, password }),
            });
      auth.user = result.user;
      auth.dialogOpen = false;
      password = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Falha ao autenticar.";
    } finally {
      loading = false;
    }
  }
</script>

{#if auth.dialogOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="auth-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) auth.dialogOpen = false;
    }}
  >
    <dialog open class="auth-dialog" aria-labelledby="auth-title">
      <button class="dialog-close" aria-label="Fechar" onclick={() => (auth.dialogOpen = false)}>
        <Icon name="close" size={16} />
      </button>

      <div class="auth-logo-banner">
        <img src="/hegemonia-logo.webp" alt="Hegemonia Emblem" />
      </div>

      <span class="eyebrow">ALTO COMANDO CENTRAL</span>
      <h2 id="auth-title">
        {mode === "login" ? "Credenciais de Comando" : "Alistamento de Comandante"}
      </h2>
      <p class="auth-intro">
        Histórico de campanhas, condecorações oficiais, estatísticas ranqueadas e rede de aliados em registro criptografado.
      </p>

      <div class="auth-tabs" role="tablist">
        <button
          type="button"
          class:active={mode === "login"}
          onclick={() => {
            mode = "login";
            error = "";
          }}
        >
          Autenticar
        </button>
        <button
          type="button"
          class:active={mode === "register"}
          onclick={() => {
            mode = "register";
            error = "";
          }}
        >
          Novo Alistamento
        </button>
      </div>

      <form onsubmit={submit}>
        {#if mode === "register"}
          <label>
            E-mail Oficial
            <input
              type="email"
              bind:value={email}
              autocomplete="email"
              required
              maxlength="254"
              placeholder="comandante@hegemonia.mil"
            />
          </label>
          <div class="form-row">
            <label>
              Identificador (Username)
              <input
                bind:value={username}
                autocomplete="username"
                required
                minlength="3"
                maxlength="24"
                pattern="[A-Za-z0-9_]+"
                placeholder="general_01"
              />
            </label>
            <label>
              Patente / Nome de Exibição
              <input
                bind:value={displayName}
                required
                maxlength="32"
                placeholder="Mal. V. Kovalenko"
              />
            </label>
          </div>
        {:else}
          <label>
            E-mail ou Identificador de Usuário
            <input
              bind:value={identifier}
              autocomplete="username"
              required
              placeholder="general_01"
            />
          </label>
        {/if}

        <label>
          Código de Segurança (Senha)
          <input
            type="password"
            bind:value={password}
            autocomplete={mode === "login" ? "current-password" : "new-password"}
            required
            minlength={mode === "register" ? 12 : 1}
            maxlength="128"
            placeholder={mode === "register" ? "Mínimo de 12 caracteres" : "Sua senha de comando"}
          />
        </label>

        {#if error}
          <p class="form-error" role="alert">{error}</p>
        {/if}

        <button class="gold-button full" disabled={loading}>
          {loading
            ? "Verificando Credenciais..."
            : mode === "login"
              ? "Ingressar no Comando"
              : "Confirmar Alistamento"}
        </button>
      </form>

      <p class="security-note">
        Sessão protegida via Argon2id e cookie HttpOnly. Comandantes convidados continuam podendo operar sem cadastro.
      </p>
    </dialog>
  </div>
{/if}
